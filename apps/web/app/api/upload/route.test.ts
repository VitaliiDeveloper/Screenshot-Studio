// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { exportBundle as exportBundleType } from "@screenshot-studio/cli/export";
import { runUploadCommand } from "@screenshot-studio/cli/upload";
import { readProjectSnapshot } from "@screenshot-studio/core/storage";
import { holdAgentRun } from "@web/lib/agents/agent-run-test-support.js";
import { ExportProgressRegistry } from "@web/lib/export-progress.server.js";
import { PROJECT_SESSION_COOKIE, projectSessionRegistry } from "@web/lib/session/project-session.server.js";
import type { LocalProjectSession } from "@web/lib/session/project-session.server.js";
import { createStoreCredentialStore, type StoreCredentialStore } from "@web/lib/store-credentials.server.js";
import { testGoogleServiceAccount } from "@web/lib/store-credentials-test-support.js";
import { UploadPlanRegistry } from "@web/lib/store-upload.server.js";
import { handleUploadPlanPost, handleUploadPost, type UploadRouteDependencies } from "./handler.js";
import { POST } from "./route.js";

const fixture = fileURLToPath(new URL("../../../../../fixtures/publishing", import.meta.url));
const operationId = `export_${"a".repeat(32)}`;
let root: string;
let session: LocalProjectSession;
let credentials: StoreCredentialStore;
let plans: UploadPlanRegistry;
let progressRegistry: ExportProgressRegistry;
let serviceAccount: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "upload-route-"));
  await cp(fixture, join(root, "project"), { recursive: true });
  session = {
    projectId: "project-1",
    projectPath: join(root, "project", "app-store-screenshots.json"),
  } as LocalProjectSession;
  credentials = createStoreCredentialStore(join(root, "data"));
  serviceAccount = testGoogleServiceAccount();
  await credentials.setGoogle(serviceAccount);
  plans = new UploadPlanRegistry();
  progressRegistry = new ExportProgressRegistry();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const request = (body: unknown) => new Request("http://localhost:3000/api/upload", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const report = {
  store: "google", packageName: "com.example.screenshots", layoutId: "default", dryRun: false, committed: true,
  locales: [], untouchedLocales: [], skipped: [],
};

type UploadDependencies = NonNullable<Parameters<typeof runUploadCommand>[2]>;

function fakeUpload(behaviour?: (dependencies: UploadDependencies) => Promise<void>) {
  return vi.fn<typeof runUploadCommand>(async (_flags, _specs, dependencies) => {
    await behaviour?.(dependencies!);
    return JSON.stringify(report);
  });
}

async function reviewPlan(dependencies: UploadRouteDependencies = {}) {
  const response = await handleUploadPlanPost(session, request({ store: "google" }), { credentials, plans, ...dependencies });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ planHash: string; revision: string } & Record<string, unknown>>;
}

const upload = (body: unknown, revision: string, dependencies: UploadRouteDependencies) => handleUploadPost(
  session,
  request(body),
  revision,
  { credentials, plans, progressRegistry, env: {}, ...dependencies },
);

describe("upload plan", () => {
  it("returns the CLI plan for the layout with a hash bound to the project revision", async () => {
    const plan = await reviewPlan();
    expect(plan).toMatchObject({
      store: "google",
      identifier: "com.example.screenshots",
      layoutId: "default",
      credentialsConfigured: true,
      plan: {
        locales: [{
          locale: "en-US",
          projectLocale: "en",
          slots: [{ imageType: "phoneScreenshots", upload: [{ screenId: "phone", screenName: "Phone" }], replace: null }],
        }],
        untouchedLocales: null,
        skipped: [],
      },
    });
    expect(plan.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await reviewPlan()).planHash).toBe(plan.planHash);
  });

  it("explains a missing package name and an unsupported store", async () => {
    const path = session.projectPath;
    const project = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    delete project.publishing;
    await writeFile(path, JSON.stringify(project));
    const missing = await handleUploadPlanPost(session, request({ store: "google" }), { credentials, plans });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ code: "missing-identifier" });
    expect((await handleUploadPlanPost(session, request({ store: "apple" }), { credentials, plans })).status).toBe(422);
  });
});

describe("upload", () => {
  it("refuses a request without the hash of a reviewed plan", async () => {
    const runUpload = fakeUpload();
    const { revision } = await reviewPlan();
    const missing = await upload({ store: "google" }, revision, { runUploadCommand: runUpload });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ code: "plan-not-confirmed" });
    const forged = await upload({ store: "google", planHash: "0".repeat(64) }, revision, { runUploadCommand: runUpload });
    expect(forged.status).toBe(409);
    expect(runUpload).not.toHaveBeenCalled();
  });

  it("keeps each tab's reviewed plan confirmable when two tabs review different layouts", async () => {
    const project = JSON.parse(await readFile(session.projectPath, "utf8")) as { layouts: Array<{ id: string; name: string }> };
    project.layouts.push({ ...structuredClone(project.layouts[0]!), id: "second", name: "Second" });
    await writeFile(session.projectPath, JSON.stringify(project));
    const review = async (layout: string) => (await handleUploadPlanPost(session, request({ store: "google", layout }), { credentials, plans }))
      .json() as Promise<{ planHash: string; revision: string }>;
    const first = await review("default");
    const second = await review("second");
    expect(second.planHash).not.toBe(first.planHash);

    const runUpload = fakeUpload();
    const confirmFirst = await upload({ store: "google", layout: "default", planHash: first.planHash }, first.revision, { runUploadCommand: runUpload });
    expect(confirmFirst.status).toBe(201);
    const confirmSecond = await upload({ store: "google", layout: "second", planHash: second.planHash }, second.revision, { runUploadCommand: runUpload });
    expect(confirmSecond.status).toBe(201);
    expect(runUpload.mock.calls.map(([flags]) => flags.layout)).toEqual(["default", "second"]);
  });

  it("refuses a stale hash once the project was edited after the plan", async () => {
    const runUpload = fakeUpload();
    const { planHash } = await reviewPlan();
    const project = JSON.parse(await readFile(session.projectPath, "utf8")) as { layouts: { screens: { name: string }[] }[] };
    project.layouts[0]!.screens[0]!.name = "Renamed";
    await writeFile(session.projectPath, JSON.stringify(project));
    const { revision } = await readProjectSnapshot(session.projectPath);

    const response = await upload({ store: "google", planHash }, revision, { runUploadCommand: runUpload });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "plan-stale" });
    expect(runUpload).not.toHaveBeenCalled();
  });

  it("runs the CLI upload once for a confirmed plan and returns its report", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const exportBundle = vi.fn(async () => "/tmp/bundle.zip");
    const runUpload = fakeUpload(async (dependencies) => {
      expect(dependencies.createRenderBrowserSession).toBeTypeOf("function");
      const server = await dependencies.startWebServer!();
      expect(server.url).toBe("http://localhost:3000");
      const { revision } = await readProjectSnapshot(session.projectPath);
      await dependencies.exportBundle!({ projectRevision: revision } as never);
      dependencies.warn!("Warning: low contrast");
    });
    const { planHash, revision } = await reviewPlan();

    const response = await upload({ store: "google", planHash, operationId }, revision, { runUploadCommand: runUpload, exportBundle });
    expect(response.status).toBe(201);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ report, warnings: ["Warning: low contrast"] });
    expect(runUpload.mock.calls[0]![0]).toEqual({
      project: session.projectPath,
      store: "google",
      layout: "default",
      "service-account": await credentials.googleServiceAccountPath(),
      json: "true",
    });
    expect(exportBundle).toHaveBeenCalledOnce();
    expect(progressRegistry.get(operationId)).toMatchObject({ phase: "ready", completed: 1, total: 1 });

    const privateKey = (JSON.parse(serviceAccount) as { private_key: string }).private_key;
    expect(body).not.toContain(privateKey.split("\n")[1]);
    expect(body).not.toContain("store-credentials");
    for (const log of logs) expect(log).not.toHaveBeenCalled();

    const replay = await upload({ store: "google", planHash, operationId }, revision, { runUploadCommand: runUpload, exportBundle });
    expect(replay.status).toBe(409);
    expect(runUpload).toHaveBeenCalledOnce();
  });

  it("stops before rendering a revision other than the reviewed one", async () => {
    const exportBundle = vi.fn(async () => "/tmp/bundle.zip");
    const runUpload = fakeUpload(async (dependencies) => {
      await dependencies.exportBundle!({ projectRevision: "other" } as never);
    });
    const { planHash, revision } = await reviewPlan();
    const response = await upload({ store: "google", planHash, operationId }, revision, { runUploadCommand: runUpload, exportBundle });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "plan-stale" });
    expect(exportBundle).not.toHaveBeenCalled();
    expect(progressRegistry.get(operationId)?.phase).toBe("failed");
  });

  it("refuses without a configured key and reports CLI failures", async () => {
    const { planHash, revision } = await reviewPlan();
    await credentials.clear("google");
    const unconfigured = await upload({ store: "google", planHash }, revision, { runUploadCommand: fakeUpload() });
    expect(unconfigured.status).toBe(409);
    expect(await unconfigured.json()).toMatchObject({ code: "not-configured" });

    await credentials.setGoogle(serviceAccount);
    const second = await reviewPlan();
    const failing = vi.fn<typeof runUploadCommand>(async () => {
      throw new Error("Google Play edits.insert failed: 403 The caller does not have permission");
    });
    const failed = await upload({ store: "google", planHash: second.planHash }, revision, { runUploadCommand: failing });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: expect.stringContaining("403") });
  });

  it("drives the real CLI upload through the editor's render and progress seams", async () => {
    const calls: string[] = [];
    const playFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url.pathname}`);
      const json = (body: unknown) => Response.json(body);
      if (url.pathname === "/token") return json({ access_token: "token-sentinel" });
      if (method === "POST" && url.pathname.endsWith("/edits")) return json({ id: "edit-1" });
      if (url.pathname.endsWith("/edits/edit-1/listings")) return json({ listings: [{ language: "en-US" }, { language: "de-DE" }] });
      if (method === "GET" && url.pathname.endsWith("/phoneScreenshots")) return json({ images: [{ id: "old" }] });
      return json({});
    }) as typeof fetch;
    const exportBundle = vi.fn<typeof exportBundleType>(async ({ outDir, entries }) => {
      for (const entry of entries) {
        await mkdir(dirname(join(outDir, entry.relativePath)), { recursive: true });
        await writeFile(join(outDir, entry.relativePath), "png");
      }
      return join(outDir, "bundle.zip");
    });
    const realUpload: typeof runUploadCommand = (flags, specs, dependencies) => runUploadCommand(flags, specs, {
      ...dependencies,
      fetch: playFetch,
      endpoints: { apiRoot: "http://play.test", tokenUrl: "http://play.test/token" },
      createRenderBrowserSession: (async () => ({ close: async () => undefined })) as never,
    });
    const { planHash, revision } = await reviewPlan();

    const response = await upload({ store: "google", planHash, operationId }, revision, { runUploadCommand: realUpload, exportBundle });
    const body = await response.text();
    expect(response.status, body).toBe(201);
    expect(JSON.parse(body).report).toMatchObject({
      committed: true,
      packageName: "com.example.screenshots",
      untouchedLocales: ["de-DE"],
      locales: [{ locale: "en-US", slots: [{ imageType: "phoneScreenshots", replace: [{ id: "old" }] }] }],
    });
    // The wrapper accepted the revision the stable export lease renders, so it matches the plan's.
    expect(exportBundle).toHaveBeenCalledOnce();
    expect(exportBundle.mock.calls[0]![0].baseUrl).toBe("http://localhost:3000");
    expect(calls).toContain("POST /androidpublisher/v3/applications/com.example.screenshots/edits/edit-1:commit");
    expect(body).not.toContain("token-sentinel");
    expect(progressRegistry.get(operationId)?.phase).toBe("ready");
  });

  it("is a 412 when the If-Match revision is not the current one", async () => {
    const { planHash } = await reviewPlan();
    const response = await upload({ store: "google", planHash }, "stale-revision", { runUploadCommand: fakeUpload() });
    expect(response.status).toBe(412);
  });
});

describe("agent isolation", () => {
  it("refuses an upload while an editor-started agent runs on the project", async () => {
    const opened = await projectSessionRegistry.openLocal(session.projectPath);
    const { revision } = await readProjectSnapshot(session.projectPath);
    const release = await holdAgentRun(join(root, "project"));
    try {
      const response = await POST(new Request("http://localhost:3000/api/upload", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          "content-type": "application/json",
          cookie: `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(opened.descriptor.sessionId)}`,
          "x-project-id": opened.projectId,
          "if-match": `"${revision}"`,
        },
        body: JSON.stringify({ store: "google", planHash: "0".repeat(64) }),
      }));
      expect(response.status).toBe(423);
      expect(await response.json()).toMatchObject({ code: "agent-running" });
    } finally {
      release();
    }
  });

  it("source-import tripwire: agent routes and agent runtime import no upload or key-store module", async () => {
    const roots = [
      fileURLToPath(new URL("../agents", import.meta.url)),
      fileURLToPath(new URL("../../../lib/agents", import.meta.url)),
    ];
    const offenders: string[] = [];
    for (const directory of roots) {
      for (const entry of await readdir(directory, { recursive: true })) {
        if (!/\.tsx?$/.test(entry)) continue;
        const source = await readFile(join(directory, entry), "utf8");
        if (/store-credentials|store-upload|api\/upload|cli\/upload/.test(source)) offenders.push(entry);
      }
    }
    expect(offenders).toEqual([]);
  });
});
