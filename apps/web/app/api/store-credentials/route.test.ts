// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { holdAgentRun } from "@web/lib/agents/agent-run-test-support.js";
import { PROJECT_SESSION_COOKIE, projectSessionRegistry } from "@web/lib/session/project-session.server.js";
import { createStoreCredentialStore, type StoreCredentialStore } from "@web/lib/store-credentials.server.js";
import { testAppleCredentials, testGoogleServiceAccount } from "@web/lib/store-credentials-test-support.js";
import { handleStoreCredentialsDelete, handleStoreCredentialsGet, handleStoreCredentialsPost } from "./handler.js";
import { DELETE, POST } from "./route.js";

const originalDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
const originalProjectPath = process.env.PROJECT_PATH;
let root: string;
let credentials: StoreCredentialStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "store-credentials-route-"));
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = join(root, "data");
  credentials = createStoreCredentialStore(join(root, "data"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalProjectPath === undefined) delete process.env.PROJECT_PATH;
  else process.env.PROJECT_PATH = originalProjectPath;
  if (originalDataRoot === undefined) delete process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  else process.env.SCREENSHOT_STUDIO_DATA_ROOT = originalDataRoot;
  await rm(root, { recursive: true, force: true });
});

const post = (body: unknown) => new Request("http://localhost:3000/api/store-credentials", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});
const projectDirectory = () => join(root, "project");

describe("store credentials route", () => {
  it("sets, reports, and clears keys while answering only configured and a timestamp", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const google = testGoogleServiceAccount();
    const apple = testAppleCredentials();
    const bodies: string[] = [];
    const call = async (response: Promise<Response>) => {
      const res = await response;
      bodies.push(await res.clone().text());
      return res;
    };

    expect(await (await call(handleStoreCredentialsGet({ credentials }))).json()).toEqual({
      stores: { google: { configured: false, updatedAt: null }, apple: { configured: false, updatedAt: null } },
    });
    const setGoogle = await call(handleStoreCredentialsPost(post({ store: "google", serviceAccount: google }), projectDirectory(), { credentials }));
    expect(setGoogle.status).toBe(200);
    expect((await setGoogle.json()).stores.google).toEqual({ configured: true, updatedAt: expect.any(String) });
    const setApple = await call(handleStoreCredentialsPost(post({ store: "apple", ...apple }), projectDirectory(), { credentials }));
    expect((await setApple.json()).stores.apple.configured).toBe(true);
    await call(handleStoreCredentialsGet({ credentials }));

    const cleared = await call(handleStoreCredentialsDelete(
      new Request("http://localhost:3000/api/store-credentials?store=google", { method: "DELETE" }),
      { credentials },
    ));
    expect((await cleared.json()).stores).toEqual({
      google: { configured: false, updatedAt: null },
      apple: { configured: true, updatedAt: expect.any(String) },
    });

    const googleKey = (JSON.parse(google) as { private_key: string }).private_key;
    for (const body of bodies) {
      for (const secret of [googleKey.split("\n")[1]!, apple.privateKey.split("\n")[1]!, apple.keyId, apple.issuerId, "client_email"]) {
        expect(body).not.toContain(secret);
      }
    }
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("rejects bad keys with fixed messages and stores nothing", async () => {
    const secret = "-----BEGIN PRIVATE KEY-----\nsentinel-secret";
    const responses = [
      await handleStoreCredentialsPost(post({ store: "google", serviceAccount: `{"private_key":"${secret}` }), projectDirectory(), { credentials }),
      await handleStoreCredentialsPost(post({ store: "apple", ...testAppleCredentials(), privateKey: secret }), projectDirectory(), { credentials }),
      await handleStoreCredentialsPost(post(`{"store":"google","serviceAccount":"${secret}`), projectDirectory(), { credentials }),
      await handleStoreCredentialsPost(post({ store: "nope" }), projectDirectory(), { credentials }),
      await handleStoreCredentialsPost(post({ store: "google", serviceAccount: "x".repeat(70_000) }), projectDirectory(), { credentials }),
      await handleStoreCredentialsPost(new Request("http://localhost:3000/api/store-credentials", {
        method: "POST",
        headers: { "content-length": "70000" },
        body: "{}",
      }), projectDirectory(), { credentials }),
    ];
    expect(responses.map(({ status }) => status)).toEqual([422, 422, 400, 400, 413, 413]);
    for (const response of responses) expect(await response.text()).not.toContain("sentinel-secret");
    expect(await credentials.status()).toMatchObject({ google: { configured: false }, apple: { configured: false } });
  });

  it("refuses to save keys when the data folder is inside the project", async () => {
    const inside = createStoreCredentialStore(join(projectDirectory(), ".screenshot-studio"));
    const response = await handleStoreCredentialsPost(
      post({ store: "google", serviceAccount: testGoogleServiceAccount() }),
      projectDirectory(),
      { credentials: inside },
    );
    expect(response.status).toBe(422);
    expect(await access(inside.directory).then(() => true, () => false)).toBe(false);
  });

  it("cannot be written by a blind cross-site POST or from a foreign host", async () => {
    await cp(fileURLToPath(new URL("../../../../../fixtures/sample", import.meta.url)), projectDirectory(), { recursive: true });
    process.env.PROJECT_PATH = join(projectDirectory(), "app-store-screenshots.json");
    const body = JSON.stringify({ store: "google", serviceAccount: testGoogleServiceAccount() });
    const blind = await POST(new Request("http://localhost:3000/api/store-credentials", {
      method: "POST",
      headers: { "content-type": "text/plain", host: "localhost:3000", origin: "https://evil.example" },
      body,
    }));
    expect(blind.status).toBe(428);
    const rebound = await POST(new Request("http://localhost:3000/api/store-credentials", {
      method: "POST",
      headers: { "content-type": "application/json", host: "rebound.example:3000", "x-project-id": "any" },
      body,
    }));
    expect(rebound.status).toBe(403);
    expect(await access(join(root, "data", "store-credentials")).then(() => true, () => false)).toBe(false);
  });

  it("refuses key changes while an editor-started agent runs on the project", async () => {
    await cp(fileURLToPath(new URL("../../../../../fixtures/sample", import.meta.url)), projectDirectory(), { recursive: true });
    const session = await projectSessionRegistry.openLocal(join(projectDirectory(), "app-store-screenshots.json"));
    const headers = {
      host: "localhost:3000",
      "content-type": "application/json",
      cookie: `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(session.descriptor.sessionId)}`,
      "x-project-id": session.projectId,
    };
    const release = await holdAgentRun(projectDirectory());
    try {
      const saved = await POST(new Request("http://localhost:3000/api/store-credentials", {
        method: "POST",
        headers,
        body: JSON.stringify({ store: "google", serviceAccount: testGoogleServiceAccount() }),
      }));
      expect(saved.status).toBe(423);
      expect(await saved.json()).toMatchObject({ code: "agent-running" });
      const cleared = await DELETE(new Request("http://localhost:3000/api/store-credentials?store=google", { method: "DELETE", headers }));
      expect(cleared.status).toBe(423);
    } finally {
      release();
    }
    expect(await access(join(root, "data", "store-credentials")).then(() => true, () => false)).toBe(false);
  });
});
