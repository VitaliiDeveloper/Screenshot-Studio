// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_ID,
  ISSUER_ID,
  KEY_ID,
  startAppStoreConnectMock,
  type MockAppStoreConnect,
} from "@screenshot-studio/cli/app-store-connect-test-support";
import { runAppStoreUploadCommand } from "@screenshot-studio/cli/app-store-upload";
import type { exportBundle as exportBundleType } from "@screenshot-studio/cli/export";
import { runUploadCommand } from "@screenshot-studio/cli/upload";
import { readProjectSnapshot } from "@screenshot-studio/core/storage";
import { holdAgentRun } from "@web/lib/agents/agent-run-test-support.js";
import { ExportProgressRegistry } from "@web/lib/export-progress.server.js";
import { PROJECT_SESSION_COOKIE, projectSessionRegistry } from "@web/lib/session/project-session.server.js";
import type { LocalProjectSession } from "@web/lib/session/project-session.server.js";
import { createStoreCredentialStore, type StoreCredentialStore } from "@web/lib/store-credentials.server.js";
import { testGoogleServiceAccount } from "@web/lib/store-credentials-test-support.js";
import type { UploadPlanResponse } from "@web/lib/store-upload.js";
import { UploadPlanRegistry } from "@web/lib/store-upload.server.js";
import { handleUploadPlanPost, handleUploadPost, type UploadRouteDependencies } from "./handler.js";
import { POST as PLAN_POST } from "./plan/route.js";
import { POST } from "./route.js";

const fixture = fileURLToPath(new URL("../../../../../fixtures/publishing", import.meta.url));
const appleExample = fileURLToPath(new URL("../../../../../examples/connected-launch", import.meta.url));
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
  { credentials, plans, progressRegistry, env: {} as NodeJS.ProcessEnv, ...dependencies },
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
    expect((await handleUploadPlanPost(session, request({ store: "microsoft" }), { credentials, plans })).status).toBe(422);
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
        if (/store-credentials|store-upload|api\/upload|cli\/upload|app-store-upload|app-store-connect/.test(source)) offenders.push(entry);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("App Store Connect upload", () => {
  let asc: MockAppStoreConnect;
  let privatePem: string;
  let closeMock: () => Promise<void>;
  let apple: LocalProjectSession;

  beforeEach(async () => {
    ({ asc, privatePem, close: closeMock } = await startAppStoreConnectMock());
    await cp(appleExample, join(root, "apple"), { recursive: true });
    const projectPath = join(root, "apple", "app-store-screenshots.json");
    const project = JSON.parse(await readFile(projectPath, "utf8")) as Record<string, unknown>;
    project.publishing = { apple: { appId: APP_ID } };
    await writeFile(projectPath, JSON.stringify(project));
    apple = { projectId: "apple-project", projectPath } as LocalProjectSession;
    await credentials.setApple({ keyId: KEY_ID, issuerId: ISSUER_ID, privateKey: privatePem });
  });

  afterEach(async () => {
    await closeMock();
  });

  type ApplePlan = Extract<UploadPlanResponse, { store: "apple" }>;

  const applePlan = async (body: Record<string, unknown> = {}) => {
    const response = await handleUploadPlanPost(apple, request({ store: "apple", ...body }), { credentials, plans, appStoreApiRoot: asc.origin });
    return { status: response.status, body: await response.json() as ApplePlan & { code?: string; error?: string } };
  };

  const appleUpload = (body: Record<string, unknown>, revision: string, dependencies: UploadRouteDependencies = {}) => handleUploadPost(
    apple,
    request({ store: "apple", ...body }),
    revision,
    { credentials, plans, progressRegistry, env: {} as NodeJS.ProcessEnv, appStoreApiRoot: asc.origin, ...dependencies },
  );

  /** The real command with the test-only seams the editor does not set: a fast poll and no browser. */
  const realAppleUpload: typeof runAppStoreUploadCommand = (flags, specs, dependencies) => runAppStoreUploadCommand(flags, specs, {
    ...dependencies,
    pollIntervalMs: 1,
    createRenderBrowserSession: (async () => ({ close: async () => undefined })) as never,
  });

  const writingExportBundle = () => vi.fn<typeof exportBundleType>(async ({ outDir, entries }) => {
    for (const [index, entry] of entries.entries()) {
      await mkdir(dirname(join(outDir, entry.relativePath)), { recursive: true });
      await writeFile(join(outDir, entry.relativePath), `png-${index}`);
    }
    return join(outDir, "bundle.zip");
  });

  it("plans the App Store sets with the only editable version of the platform", async () => {
    const project = JSON.parse(await readFile(apple.projectPath, "utf8")) as { layouts: Array<{ screens: Array<{ id: string }> }> };
    const hero = project.layouts[0]!.screens.find(({ id }) => id === "hero")!;
    project.layouts[0]!.screens.push({ ...structuredClone(hero), id: "duo", name: "Duo", storeTargetId: "duo-inner" } as never);
    await writeFile(apple.projectPath, JSON.stringify(project));
    const { status, body } = await applePlan();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      store: "apple",
      identifier: APP_ID,
      credentialsConfigured: true,
      versions: [{ platform: "IOS", editable: [{ versionString: "1.2", state: "PREPARE_FOR_SUBMISSION" }], selected: "1.2" }],
      version: null,
      blocked: null,
      plan: {
        locales: [{
          platform: "IOS",
          locale: "en-US",
          projectLocale: "en",
          sets: [{ displayType: "APP_IPHONE_61", replace: null }],
        }],
      },
    });
    expect(body.plan.locales[0]!.sets[0]!.upload.map(({ screenId }) => screenId)).toEqual(["hero", "save-fast", "stay-organized"]);
    expect(body.plan.skipped).toEqual([
      { screenId: "duo", platform: "apple", device: "iphone", sizeId: "duo-inner", reason: expect.stringMatching(/\S/) },
    ]);
    expect(asc.calls).toEqual([`GET /apps/${APP_ID}/appStoreVersions`]);
  });

  it("asks for a version where a platform has several, and hashes the choice", async () => {
    asc.versions.push({ id: "ver-2", versionString: "1.3", appVersionState: "READY_FOR_REVIEW" });
    const open = await applePlan();
    expect(open.status).toBe(200);
    expect(open.body.versions).toEqual([{
      platform: "IOS",
      editable: [{ versionString: "1.2", state: "PREPARE_FOR_SUBMISSION" }, { versionString: "1.3", state: "READY_FOR_REVIEW" }],
      selected: null,
    }]);
    const unpicked = await appleUpload({ planHash: open.body.planHash }, open.body.revision, { runAppStoreUploadCommand: vi.fn() });
    expect(unpicked.status).toBe(409);
    expect(await unpicked.json()).toMatchObject({ code: "version-required" });

    const picked = await applePlan({ version: "1.3" });
    expect(picked.body).toMatchObject({ version: "1.3", versions: [{ selected: "1.3" }] });
    expect(picked.body.planHash).not.toBe(open.body.planHash);
    expect((await applePlan({ version: "1.2" })).body.planHash).not.toBe(picked.body.planHash);

    const unknown = await applePlan({ version: "9.9" });
    expect(unknown.status).toBe(422);
    expect(unknown.body).toMatchObject({ code: "unknown-version", error: expect.stringContaining("1.2, 1.3") });
    expect(unknown.body.error).not.toContain("9.9");

    // The hash binds the choice: confirming the 1.3 plan with another version is a stale plan.
    const swapped = await appleUpload({ planHash: picked.body.planHash, version: "1.2" }, picked.body.revision, { runAppStoreUploadCommand: vi.fn() });
    expect(swapped.status).toBe(409);
    expect(await swapped.json()).toMatchObject({ code: "plan-stale" });
  });

  it("keeps the plan hash when App Store Connect lists the versions in another order", async () => {
    asc.versions.push({ id: "ver-0", versionString: "1.1", appVersionState: "READY_FOR_REVIEW" });
    const first = await applePlan({ version: "1.2" });
    expect(first.body.versions![0]!.editable.map(({ versionString }) => versionString)).toEqual(["1.1", "1.2"]);
    asc.versions.reverse();
    expect((await applePlan({ version: "1.2" })).body.planHash).toBe(first.body.planHash);
  });

  it("passes the picked version, the key path and the ids to the command only", async () => {
    asc.versions.push({ id: "ver-2", versionString: "1.3", appVersionState: "READY_FOR_REVIEW" });
    const { body } = await applePlan({ version: "1.3" });
    const run = vi.fn<typeof runAppStoreUploadCommand>(async () => ({ output: JSON.stringify({ store: "apple" }), exitCode: 0 }));
    const response = await appleUpload({ planHash: body.planHash, version: "1.3" }, body.revision, { runAppStoreUploadCommand: run });
    expect(response.status).toBe(201);
    const [flags, , dependencies] = run.mock.calls[0]!;
    const stored = (await credentials.appleCredentials())!;
    expect(flags).toEqual({ project: apple.projectPath, store: "apple", layout: "default", "key-path": stored.keyPath, version: "1.3", json: "true" });
    expect(dependencies!.env).toMatchObject({ APP_STORE_CONNECT_KEY_ID: KEY_ID, APP_STORE_CONNECT_ISSUER_ID: ISSUER_ID });
    expect(dependencies!.apiRoot).toBe(asc.origin);
    expect(process.env.APP_STORE_CONNECT_KEY_ID).toBeUndefined();
    expect(process.env.APP_STORE_CONNECT_ISSUER_ID).toBeUndefined();
  });

  it("refuses an upload once App Store Connect versions changed after the review", async () => {
    const { body } = await applePlan();
    asc.versions[0]!.appVersionState = "READY_FOR_REVIEW";
    const run = vi.fn<typeof runAppStoreUploadCommand>();
    const response = await appleUpload({ planHash: body.planHash }, body.revision, { runAppStoreUploadCommand: run });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "plan-stale" });
    expect(run).not.toHaveBeenCalled();
  });

  it("explains a platform without an editable version and refuses its upload", async () => {
    asc.versions = [];
    const { status, body } = await applePlan();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      versions: [{ platform: "IOS", editable: [], selected: null }],
      blocked: "IOS has no editable version; create one in App Store Connect first",
    });
    const response = await appleUpload({ planHash: body.planHash }, body.revision, { runAppStoreUploadCommand: vi.fn() });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "version-unavailable" });

    const project = JSON.parse(await readFile(apple.projectPath, "utf8")) as { layouts: Array<{ screens: Array<{ id: string }> }> };
    const hero = project.layouts[0]!.screens.find(({ id }) => id === "hero")!;
    project.layouts[0]!.screens.push({ ...structuredClone(hero), id: "mac", name: "Mac", device: "macos", artboard: { width: 1440, height: 900 } } as never);
    await writeFile(apple.projectPath, JSON.stringify(project));
    expect((await applePlan()).body.blocked).toBe("IOS and MAC_OS have no editable version; create one in App Store Connect first");
  });

  it("plans offline without a key and refuses the upload", async () => {
    await credentials.clear("apple");
    const { status, body } = await applePlan();
    expect(status).toBe(200);
    expect(body).toMatchObject({ credentialsConfigured: false, versions: null });
    expect(asc.calls).toEqual([]);
    const response = await appleUpload({ planHash: body.planHash }, body.revision, { runAppStoreUploadCommand: vi.fn() });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "not-configured" });
  });

  it("reports a rejected key as a store failure without echoing it", async () => {
    await credentials.setApple({ keyId: "OTHERKEY12", issuerId: ISSUER_ID, privateKey: privatePem });
    const { status, body } = await applePlan();
    expect(status).toBe(502);
    expect(body.error).toContain("401");
    expect(JSON.stringify(body)).not.toContain("OTHERKEY12");
  });

  it("drives the real Apple CLI upload through the editor's render and progress seams without leaking the key", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const exportBundle = writingExportBundle();
    const { body: reviewed } = await applePlan();
    const response = await appleUpload({ planHash: reviewed.planHash, operationId }, reviewed.revision, {
      runAppStoreUploadCommand: realAppleUpload,
      exportBundle,
    });
    const text = await response.text();
    expect(response.status, text).toBe(201);
    expect(JSON.parse(text).report).toMatchObject({
      store: "apple",
      appId: APP_ID,
      versions: [{ platform: "IOS", versionString: "1.2" }],
      locales: [{ locale: "en-US", sets: [{ displayType: "APP_IPHONE_61", replace: [{ id: "old-a" }, { id: "old-b" }], state: "replaced" }] }],
    });
    expect(exportBundle).toHaveBeenCalledOnce();
    expect(exportBundle.mock.calls[0]![0].baseUrl).toBe("http://localhost:3000");
    expect(asc.calls.filter((call) => call === "POST /appScreenshots")).toHaveLength(3);
    expect(progressRegistry.get(operationId)?.phase).toBe("ready");

    const planText = JSON.stringify(reviewed);
    for (const exposed of [text, planText]) {
      expect(exposed).not.toContain(privatePem.split("\n")[1]!);
      expect(exposed).not.toContain(KEY_ID);
      expect(exposed).not.toContain(ISSUER_ID);
      expect(exposed).not.toContain("store-credentials");
      expect(exposed).not.toContain(asc.origin);
      for (const { token } of asc.tokens) expect(exposed).not.toContain(token.split(".")[2]!);
    }
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("returns the per-set report when App Store Connect stops the upload part-way", async () => {
    asc.fail.push({ method: "DELETE", path: "/appScreenshots/old-b" });
    const { body: reviewed } = await applePlan();
    const response = await appleUpload({ planHash: reviewed.planHash, operationId }, reviewed.revision, {
      runAppStoreUploadCommand: realAppleUpload,
      exportBundle: writingExportBundle(),
    });
    expect(response.status).toBe(201);
    const { report } = await response.json() as { report: { locales: Array<{ sets: Array<{ state: string; error?: string }> }> } };
    expect(report.locales[0]!.sets[0]).toMatchObject({ state: "partial", error: expect.stringContaining("cannot be changed now") });
    expect(progressRegistry.get(operationId)?.phase).toBe("failed");
  });

  it("refuses an Apple plan while an editor-started agent runs on the project", async () => {
    const opened = await projectSessionRegistry.openLocal(apple.projectPath);
    const release = await holdAgentRun(join(root, "apple"));
    try {
      const response = await PLAN_POST(new Request("http://localhost:3000/api/upload/plan", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          "content-type": "application/json",
          cookie: `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(opened.descriptor.sessionId)}`,
          "x-project-id": opened.projectId,
        },
        body: JSON.stringify({ store: "apple" }),
      }));
      expect(response.status).toBe(423);
      expect(await response.json()).toMatchObject({ code: "agent-running" });
      expect(asc.calls).toEqual([]);
    } finally {
      release();
    }
  });
});
