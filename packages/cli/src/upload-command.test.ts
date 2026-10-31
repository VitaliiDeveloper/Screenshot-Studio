// SPDX-License-Identifier: Apache-2.0
import { generateKeyPairSync, verify, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExportCommandDependencies } from "./export-command.js";
import { runUploadCommand, type UploadCommandDependencies } from "./upload-command.js";

const storeSpecsPath = fileURLToPath(new URL("../../../store-specs.json", import.meta.url));
const PACKAGE = "com.example.launch";
const ACCESS_TOKEN = "ya29.mock-access-token-secret";
const APP = `/androidpublisher/v3/applications/${PACKAGE}`;

interface MockPlay {
  origin: string;
  calls: string[];
  uploads: Array<{ path: string; contentType: string | undefined; bytes: Buffer }>;
  assertions: string[];
  fail: { method: string; path: string } | undefined;
}

let roots: string[] = [];
let server: Server;
let play: MockPlay;
let publicKey: KeyObject;
let privatePem: string;

function readBody(request: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => done(Buffer.concat(chunks)));
  });
}

beforeEach(async () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  publicKey = pair.publicKey;
  privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  play = { origin: "", calls: [], uploads: [], assertions: [], fail: undefined };
  server = createServer(async (request, response) => {
    const body = await readBody(request);
    const url = new URL(request.url!, "http://mock");
    const path = url.pathname;
    const reply = (status: number, payload?: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    if (path === "/token") {
      const form = new URLSearchParams(body.toString());
      const assertion = form.get("assertion") ?? "";
      play.assertions.push(assertion);
      const [header, claims, signature] = assertion.split(".");
      const valid = form.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer"
        && verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature ?? "", "base64url"));
      const decoded = JSON.parse(Buffer.from(claims ?? "", "base64url").toString());
      play.calls.push("token");
      if (!valid || decoded.aud !== `${play.origin}/token` || decoded.scope !== "https://www.googleapis.com/auth/androidpublisher") {
        return reply(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." });
      }
      return reply(200, { access_token: ACCESS_TOKEN, expires_in: 3600, token_type: "Bearer" });
    }
    if (request.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) return reply(401, { error: { message: "Unauthenticated" } });
    const call = `${request.method} ${path.replace(APP, "")}`;
    play.calls.push(call);
    if (play.fail && play.fail.method === request.method && path.endsWith(play.fail.path)) {
      return reply(500, { error: { message: "Backend error" } });
    }
    if (request.method === "POST" && path === `${APP}/edits`) return reply(200, { id: "edit-1" });
    if (request.method === "GET" && path === `${APP}/edits/edit-1/listings`) {
      return reply(200, { listings: [{ language: "en-US" }, { language: "de-DE" }] });
    }
    if (request.method === "GET" && path === `${APP}/edits/edit-1/listings/en-US/phoneScreenshots`) {
      return reply(200, { images: [{ id: "old-a", sha256: "x" }, { id: "old-b", sha256: "y" }] });
    }
    if (request.method === "DELETE" && path === `${APP}/edits/edit-1/listings/en-US/phoneScreenshots`) {
      return reply(200, { deleted: [{ id: "old-a" }, { id: "old-b" }] });
    }
    if (request.method === "POST" && path === `/upload${APP}/edits/edit-1/listings/en-US/phoneScreenshots`) {
      expect(url.searchParams.get("uploadType")).toBe("media");
      play.uploads.push({ path, contentType: request.headers["content-type"], bytes: body });
      return reply(200, { image: { id: `new-${play.uploads.length}` } });
    }
    if (request.method === "POST" && path === `${APP}/edits/edit-1:commit`) return reply(200, { id: "edit-1" });
    if (request.method === "DELETE" && path === `${APP}/edits/edit-1`) return reply(204);
    return reply(404, { error: { message: `No mock for ${request.method} ${path}` } });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  play.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((done) => server.close(done));
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

async function fixture(publishing: unknown = { google: { packageName: PACKAGE } }) {
  const root = await mkdtemp(join(tmpdir(), "upload-command-"));
  roots.push(root);
  const projectPath = join(root, "app-store-screenshots.json");
  const project = JSON.parse(await readFile(new URL("../../../examples/connected-launch/app-store-screenshots.json", import.meta.url), "utf8"));
  const android = project.layouts[0].screens.find((screen: { platform: string }) => screen.platform === "android");
  project.layouts[0].screens.push({ ...structuredClone(android), id: `${android.id}-two`, name: "Second" });
  if (publishing) project.publishing = publishing;
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  const accountPath = join(root, "service-account.json");
  await writeFile(accountPath, JSON.stringify({
    type: "service_account",
    client_email: "uploader@example.iam.gserviceaccount.com",
    private_key: privatePem,
  }));
  return { root, projectPath, accountPath, androidId: android.id as string };
}

function dependencies(env: NodeJS.ProcessEnv = {}): UploadCommandDependencies & { log: ReturnType<typeof vi.fn> } {
  const log = vi.fn();
  const exportBundle = vi.fn<NonNullable<ExportCommandDependencies["exportBundle"]>>(async ({ outDir, entries }) => {
    for (const [index, entry] of entries.entries()) {
      await mkdir(dirname(join(outDir, entry.relativePath)), { recursive: true });
      await writeFile(join(outDir, entry.relativePath), Buffer.from(`png-${index}`));
    }
    return join(outDir, "bundle.zip");
  });
  return {
    env,
    log,
    fetch,
    endpoints: { apiRoot: play.origin, tokenUrl: `${play.origin}/token` },
    startWebServer: vi.fn(async () => ({ url: "http://localhost:4000", exited: new Promise<Error>(() => undefined), stop: vi.fn(async () => undefined) })) as never,
    createRenderBrowserSession: vi.fn(async () => ({ close: vi.fn(async () => undefined) })) as never,
    exportBundle,
  };
}

function expectNoSecrets(text: string) {
  expect(text).not.toContain(ACCESS_TOKEN);
  expect(text).not.toContain(privatePem.split("\n")[1]!);
  for (const assertion of play.assertions) expect(text).not.toContain(assertion.split(".")[2]!);
  expect(text).not.toContain(play.origin);
}

describe("runUploadCommand --store google", () => {
  it("replaces the touched slot inside one committed edit, in project order, without leaking credentials", async () => {
    const { projectPath, accountPath, androidId } = await fixture();
    const deps = dependencies({ GOOGLE_PLAY_SERVICE_ACCOUNT_PATH: accountPath });

    const output = await runUploadCommand({ project: projectPath, store: "google", json: "true" }, storeSpecsPath, deps);

    expect(play.calls).toEqual([
      "token",
      "POST /edits",
      "GET /edits/edit-1/listings",
      "GET /edits/edit-1/listings/en-US/phoneScreenshots",
      "DELETE /edits/edit-1/listings/en-US/phoneScreenshots",
      "POST /upload/edits/edit-1/listings/en-US/phoneScreenshots",
      "POST /upload/edits/edit-1/listings/en-US/phoneScreenshots",
      "POST /edits/edit-1:commit",
    ]);
    expect(play.uploads.map(({ bytes, contentType }) => [bytes.toString(), contentType]))
      .toEqual([["png-0", "image/png"], ["png-1", "image/png"]]);
    const report = JSON.parse(output);
    expect(report).toMatchObject({ store: "google", packageName: PACKAGE, dryRun: false, committed: true, untouchedLocales: ["de-DE"] });
    expect(report.locales[0].slots[0]).toEqual({
      imageType: "phoneScreenshots",
      upload: [expect.objectContaining({ screenId: androidId }), expect.objectContaining({ screenId: `${androidId}-two` })],
      replace: [{ id: "old-a" }, { id: "old-b" }],
    });
    expectNoSecrets(output);
    expectNoSecrets(JSON.stringify(deps.log.mock.calls));
  });

  it("abandons the edit when an upload fails mid-plan and reports that nothing changed", async () => {
    const { projectPath, accountPath } = await fixture();
    play.fail = { method: "POST", path: "/listings/en-US/phoneScreenshots" };

    const error = await runUploadCommand(
      { project: projectPath, store: "google", "service-account": accountPath },
      storeSpecsPath,
      dependencies(),
    ).catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/Google Play edits\.images\.upload failed: 500 Backend error\nThe edit was abandoned; nothing changed on Google Play\./);
    expect(play.calls).not.toContain("POST /edits/edit-1:commit");
    expect(play.calls.at(-1)).toBe("DELETE /edits/edit-1");
    expectNoSecrets((error as Error).message);
  });

  it("abandons on a rejected commit, but calls a commit without a response unknown", async () => {
    const { projectPath, accountPath } = await fixture();
    play.fail = { method: "POST", path: ":commit" };
    await expect(runUploadCommand({ project: projectPath, store: "google", "service-account": accountPath }, storeSpecsPath, dependencies()))
      .rejects.toThrow(/edits\.commit failed: 500 Backend error\nThe edit was abandoned; nothing changed on Google Play\./);
    expect(play.calls.at(-1)).toBe("DELETE /edits/edit-1");

    play.fail = undefined;
    play.calls = [];
    const deps = dependencies();
    deps.fetch = (async (input: string | URL | Request, init?: RequestInit) => String(input).endsWith(":commit")
      ? Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }))
      : fetch(input, init)) as typeof fetch;
    const error = await runUploadCommand({ project: projectPath, store: "google", "service-account": accountPath }, storeSpecsPath, deps)
      .catch((caught: Error) => caught);
    expect((error as Error).message).toBe(
      "Google Play edits.commit failed: network error (ECONNRESET)\nThe commit outcome is unknown; check Play Console before uploading again.",
    );
    expect(play.calls).not.toContain("DELETE /edits/edit-1");
  });

  it("prints the plan for --dry-run without credentials, rendering or network", async () => {
    const { projectPath } = await fixture();
    const deps = dependencies();

    const output = await runUploadCommand({ project: projectPath, store: "google", "dry-run": "true" }, storeSpecsPath, deps);

    expect(output).toMatch(/^Google Play com\.example\.launch \(layout default\)\nen-US phoneScreenshots: upload .+ \(replaces every current image\)/);
    expect(output).toMatch(/Other store locales are untouched\nDry run: no edit was created$/);
    expect(play.calls).toEqual([]);
    expect(deps.exportBundle).not.toHaveBeenCalled();
  });

  it("refuses under the agent marker, even with --dry-run", async () => {
    const { projectPath, accountPath } = await fixture();
    for (const flags of [{ "dry-run": "true" }, {}]) {
      await expect(runUploadCommand(
        { project: projectPath, store: "google", ...flags },
        storeSpecsPath,
        dependencies({ SCREENSHOT_STUDIO_AGENT: "1", GOOGLE_PLAY_SERVICE_ACCOUNT_PATH: accountPath }),
      )).rejects.toThrow(/human-only action and does not run in an agent session \(SCREENSHOT_STUDIO_AGENT is set\)/);
    }
    expect(play.calls).toEqual([]);
  });

  it("requires the package name and a service account path", async () => {
    const missing = await fixture(null);
    await expect(runUploadCommand({ project: missing.projectPath, store: "google", "dry-run": "true" }, storeSpecsPath, dependencies()))
      .rejects.toThrow(/screenshots publishing set --google-package <name>/);
    const { projectPath } = await fixture();
    await expect(runUploadCommand({ project: projectPath, store: "google" }, storeSpecsPath, dependencies()))
      .rejects.toThrow(/Set GOOGLE_PLAY_SERVICE_ACCOUNT_PATH .* or pass --service-account <path>/);
    await expect(runUploadCommand({ project: projectPath, store: "apple", "dry-run": "true" }, storeSpecsPath, dependencies()))
      .rejects.toThrow(/only --store google is available/);
    expect(play.calls).toEqual([]);
  });

  it("stops at a rejected token exchange without opening an edit", async () => {
    const { projectPath, root } = await fixture();
    const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const wrongAccount = join(root, "wrong.json");
    await writeFile(wrongAccount, JSON.stringify({ client_email: "x@example.com", private_key: otherKey }));

    await expect(runUploadCommand({ project: projectPath, store: "google", "service-account": wrongAccount }, storeSpecsPath, dependencies()))
      .rejects.toThrow(/^Google Play token exchange failed: 400 Invalid JWT Signature\.$/);
    expect(play.calls).toEqual(["token"]);
  });
});
