// SPDX-License-Identifier: Apache-2.0
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_ID,
  decode,
  ISSUER_ID,
  KEY_ID,
  startAppStoreConnectMock,
  type MockAppStoreConnect,
} from "./app-store-connect-test-support.js";
import { runAppStoreUploadCommand, type AppStoreUploadDependencies } from "./app-store-upload-command.js";
import type { ExportCommandDependencies } from "./export-command.js";

const storeSpecsPath = fileURLToPath(new URL("../../../store-specs.json", import.meta.url));

let roots: string[] = [];
let asc: MockAppStoreConnect;
let privatePem: string;
let closeMock: () => Promise<void>;

beforeEach(async () => {
  ({ asc, privatePem, close: closeMock } = await startAppStoreConnectMock());
});

afterEach(async () => {
  await closeMock();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

/** connected-launch plus a German hero (a set to create) and an iPhone Duo screen (no display type). */
async function fixture(publishing: unknown = { apple: { appId: APP_ID } }) {
  const root = await mkdtemp(join(tmpdir(), "app-store-upload-"));
  roots.push(root);
  const projectPath = join(root, "app-store-screenshots.json");
  const project = JSON.parse(await readFile(new URL("../../../examples/connected-launch/app-store-screenshots.json", import.meta.url), "utf8"));
  const hero = project.layouts[0].screens.find((screen: { id: string }) => screen.id === "hero");
  project.layouts[0].screens.push(
    { ...structuredClone(hero), id: "hero-de", name: "Hero DE", locale: "de" },
    { ...structuredClone(hero), id: "duo", name: "Duo", storeTargetId: "duo-inner" },
  );
  if (publishing) project.publishing = publishing;
  await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  const keyPath = join(root, `AuthKey_${KEY_ID}.p8`);
  await writeFile(keyPath, privatePem);
  return { root, projectPath, keyPath };
}

/** Appends screens built from the hero to the fixture project. */
async function addScreens(projectPath: string, ...screens: Array<Record<string, unknown>>) {
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  const hero = project.layouts[0].screens.find((screen: { id: string }) => screen.id === "hero");
  project.layouts[0].screens.push(...screens.map((screen) => ({ ...structuredClone(hero), ...screen })));
  await writeFile(projectPath, JSON.stringify(project));
}

function dependencies(env: NodeJS.ProcessEnv = {}) {
  const exportBundle = vi.fn<NonNullable<ExportCommandDependencies["exportBundle"]>>(async ({ outDir, entries }) => {
    for (const [index, entry] of entries.entries()) {
      await mkdir(dirname(join(outDir, entry.relativePath)), { recursive: true });
      await writeFile(join(outDir, entry.relativePath), Buffer.from(`png-bytes-${index}`));
    }
    return join(outDir, "bundle.zip");
  });
  return {
    env: { APP_STORE_CONNECT_KEY_ID: KEY_ID, APP_STORE_CONNECT_ISSUER_ID: ISSUER_ID, ...env },
    fetch,
    apiRoot: asc.origin,
    pollIntervalMs: 1,
    startWebServer: vi.fn(async () => ({ url: "http://localhost:4000", exited: new Promise<Error>(() => undefined), stop: vi.fn(async () => undefined) })) as never,
    createRenderBrowserSession: vi.fn(async () => ({ close: vi.fn(async () => undefined) })) as never,
    exportBundle,
    warn: vi.fn<(message: string) => void>(),
  } satisfies AppStoreUploadDependencies;
}

function expectNoSecrets(text: string) {
  expect(text).not.toContain(privatePem.split("\n")[1]!);
  for (const { token } of asc.tokens) expect(text).not.toContain(token.split(".")[2]!);
  expect(text).not.toContain(asc.origin);
  expect(text).not.toContain(KEY_ID);
  expect(text).not.toContain(ISSUER_ID);
}

const MAC_SCREEN = { id: "mac", name: "Mac", device: "macos", artboard: { width: 1440, height: 900 } };

const mutations = () => asc.calls.filter((call) => !call.startsWith("GET"));

describe("runAppStoreUploadCommand", () => {
  it("replaces each touched set in plan order, creating missing sets, without leaking credentials", async () => {
    const { projectPath, keyPath } = await fixture();
    const deps = dependencies({ APP_STORE_CONNECT_KEY_PATH: keyPath });

    const { output, exitCode } = await runAppStoreUploadCommand({ project: projectPath, store: "apple", json: "true" }, storeSpecsPath, deps);

    expect(exitCode).toBe(0);
    expect(asc.versionQueries.map((query) => [query.get("filter[platform]"), query.get("filter[appVersionState]")])).toEqual([[
      "IOS",
      "PREPARE_FOR_SUBMISSION,READY_FOR_REVIEW,DEVELOPER_REJECTED,REJECTED,METADATA_REJECTED,WAITING_FOR_REVIEW,INVALID_BINARY",
    ]]);
    expect(asc.calls.slice(0, 7)).toEqual([
      `GET /apps/${APP_ID}/appStoreVersions`,
      "GET /appStoreVersions/ver-1/appStoreVersionLocalizations",
      "GET /appStoreVersionLocalizations/loc-en/appScreenshotSets",
      "GET /appScreenshotSets/set-en/appScreenshots",
      "GET /appStoreVersionLocalizations/loc-de/appScreenshotSets",
      "DELETE /appScreenshots/old-a",
      "DELETE /appScreenshots/old-b",
    ]);
    expect(mutations()).toEqual([
      "DELETE /appScreenshots/old-a",
      "DELETE /appScreenshots/old-b",
      ...[1, 2, 3].flatMap((n) => ["POST /appScreenshots", `PUT upload shot-${n} part 0`, `PUT upload shot-${n} part 1`, `PATCH /appScreenshots/shot-${n}`]),
      "POST /appScreenshotSets",
      "POST /appScreenshots", "PUT upload shot-4 part 0", "PUT upload shot-4 part 1", "PATCH /appScreenshots/shot-4",
    ]);
    expect(asc.screenshots.get("set-en")).toEqual(["shot-1", "shot-2", "shot-3"]);
    expect(asc.sets.at(-1)).toEqual({ id: "set-new-2", localization: "loc-de", displayType: "APP_IPHONE_61" });
    expect(asc.screenshots.get("set-new-2")).toEqual(["shot-4"]);
    expect(asc.screenshots.get("set-en-ipad")).toEqual(["old-ipad"]);
    expect(asc.parts.every(({ authorization, contentType }) => authorization === undefined && contentType === "image/png")).toBe(true);
    expect(Buffer.concat(asc.parts.filter(({ screenshot }) => screenshot === "shot-1").map(({ bytes }) => bytes)).toString()).toBe("png-bytes-0");
    expect(asc.checksums.get("shot-4")).toBe(createHash("md5").update("png-bytes-3").digest("hex"));
    expect(asc.calls.filter((call) => call === "GET /appScreenshots/shot-1")).toHaveLength(2);

    const report = JSON.parse(output);
    expect(report).toMatchObject({ store: "apple", appId: APP_ID, dryRun: false, versions: [{ platform: "IOS", versionString: "1.2", state: "PREPARE_FOR_SUBMISSION" }] });
    expect(report.locales.map(({ locale, sets }: { locale: string; sets: Array<{ displayType: string; state: string; replace: unknown }> }) =>
      [locale, sets.map(({ displayType, state, replace }) => [displayType, state, replace])])).toEqual([
      ["en-US", [["APP_IPHONE_61", "replaced", [{ id: "old-a" }, { id: "old-b" }]]]],
      ["de-DE", [["APP_IPHONE_61", "replaced", []]]],
    ]);
    expect(report.skipped).toEqual([{
      screenId: "duo", platform: "apple", device: "iphone", sizeId: "duo-inner",
      reason: "The App Store Connect API has no display type for iPhone Duo screenshots",
    }]);
    expectNoSecrets(output);
  });

  it("stops at a screenshot that fails processing, reports the set partial and the rest untouched, and exits non-zero", async () => {
    const { projectPath, keyPath } = await fixture();
    asc.failProcessing.add("shot-2");

    const { output, exitCode } = await runAppStoreUploadCommand(
      { project: projectPath, store: "apple", "key-path": keyPath },
      storeSpecsPath,
      dependencies(),
    );

    expect(exitCode).toBe(1);
    expect(output).toContain("IOS en-US APP_IPHONE_61: upload hero, save-fast, stay-organized (replaces 2 current): partial (App Store Connect could not process a screenshot: The dimensions of one or more screenshots are wrong.)");
    expect(output).toContain("IOS de-DE APP_IPHONE_61: upload hero-de (replaces 0 current): untouched");
    expect(output).toMatch(/Replaced 0 of 2 screenshot sets$/);
    expect(asc.calls).not.toContain("POST /appScreenshotSets");
    expectNoSecrets(output);
  });

  it("reports a set failed when its first change is rejected", async () => {
    const { projectPath, keyPath } = await fixture();
    asc.fail = [{ method: "DELETE", path: "/appScreenshots/old-a" }];

    const { output, exitCode } = await runAppStoreUploadCommand(
      { project: projectPath, store: "apple", "key-path": keyPath, json: "true" },
      storeSpecsPath,
      dependencies(),
    );

    expect(exitCode).toBe(1);
    const sets = JSON.parse(output).locales.map(({ sets: [set] }: { sets: Array<{ state: string; error?: string }> }) => set);
    expect(sets).toEqual([
      expect.objectContaining({ state: "failed", error: "App Store Connect appScreenshots delete failed: 409 The screenshot set cannot be changed now." }),
      expect.objectContaining({ state: "untouched" }),
    ]);
    expect(mutations()).toEqual(["DELETE /appScreenshots/old-a"]);
  });

  it("stops with the list and changes nothing when the editable version is ambiguous or missing", async () => {
    const { projectPath, keyPath } = await fixture();
    const flags = { project: projectPath, store: "apple", "key-path": keyPath };
    asc.versions.push({ id: "ver-2", versionString: "1.3", appVersionState: "DEVELOPER_REJECTED" });
    const deps = dependencies();
    await expect(runAppStoreUploadCommand(flags, storeSpecsPath, deps)).rejects.toThrow(
      /^IOS has several editable versions: 1\.2 \(PREPARE_FOR_SUBMISSION\), 1\.3 \(DEVELOPER_REJECTED\); pass --version <string>\nNothing was changed on App Store Connect\.$/,
    );
    await expect(runAppStoreUploadCommand({ ...flags, version: "2.0" }, storeSpecsPath, deps)).rejects.toThrow(
      /^IOS has no editable version 2\.0; editable: 1\.2 \(PREPARE_FOR_SUBMISSION\), 1\.3 \(DEVELOPER_REJECTED\)\n/,
    );
    expect(deps.exportBundle).not.toHaveBeenCalled();

    asc.versions = [{ id: "ver-9", versionString: "1.1", appVersionState: "READY_FOR_DISTRIBUTION" }];
    await expect(runAppStoreUploadCommand(flags, storeSpecsPath, deps))
      .rejects.toThrow(/^IOS has no editable version; create one in App Store Connect first\nNothing was changed/);
    expect(mutations()).toEqual([]);

    asc.versions = [
      { id: "ver-1", versionString: "1.2", appVersionState: "PREPARE_FOR_SUBMISSION" },
      { id: "ver-2", versionString: "1.3", appVersionState: "DEVELOPER_REJECTED" },
    ];
    const { exitCode } = await runAppStoreUploadCommand({ ...flags, version: "1.3" }, storeSpecsPath, deps);
    expect(exitCode).toBe(0);
    expect(asc.calls).toContain("GET /appStoreVersions/ver-2/appStoreVersionLocalizations");
  });

  it("selects a version per App Store platform and stops when the Mac app has none", async () => {
    const { projectPath, keyPath } = await fixture();
    await addScreens(projectPath, MAC_SCREEN);
    const deps = dependencies();

    await expect(runAppStoreUploadCommand({ project: projectPath, store: "apple", "key-path": keyPath }, storeSpecsPath, deps))
      .rejects.toThrow(/^MAC_OS has no editable version; create one in App Store Connect first\nNothing was changed/);
    expect(asc.versionQueries.map((query) => query.get("filter[platform]"))).toEqual(["IOS", "MAC_OS"]);
    expect(deps.exportBundle).not.toHaveBeenCalled();
    expect(mutations()).toEqual([]);
  });

  it("picks each platform's only editable version, uses --version only where a platform has several, and replaces sets on both", async () => {
    const { projectPath, keyPath } = await fixture();
    await addScreens(projectPath, MAC_SCREEN);
    asc.versions.push(
      { id: "ver-2", versionString: "1.3", appVersionState: "READY_FOR_REVIEW" },
      { id: "ver-mac", versionString: "5.0", appVersionState: "PREPARE_FOR_SUBMISSION", platform: "MAC_OS" },
    );

    const { output, exitCode } = await runAppStoreUploadCommand(
      { project: projectPath, store: "apple", "key-path": keyPath, version: "1.3", json: "true" },
      storeSpecsPath,
      dependencies(),
    );

    expect(exitCode).toBe(0);
    const report = JSON.parse(output);
    expect(report.versions).toEqual([
      { platform: "IOS", versionString: "1.3", state: "READY_FOR_REVIEW" },
      { platform: "MAC_OS", versionString: "5.0", state: "PREPARE_FOR_SUBMISSION" },
    ]);
    expect(report.locales.map(({ platform, locale, sets }: { platform: string; locale: string; sets: Array<{ displayType: string; state: string }> }) =>
      `${platform} ${locale} ${sets.map(({ displayType, state }) => `${displayType}=${state}`).join(",")}`)).toEqual([
      "IOS en-US APP_IPHONE_61=replaced",
      "IOS de-DE APP_IPHONE_61=replaced",
      "MAC_OS en-US APP_DESKTOP=replaced",
    ]);
    expect(asc.calls).toContain("GET /appStoreVersions/ver-2/appStoreVersionLocalizations");
    expect(asc.calls).toContain("GET /appStoreVersions/ver-mac/appStoreVersionLocalizations");
    expect(asc.sets.filter(({ displayType }) => displayType === "APP_DESKTOP")).toEqual([
      expect.objectContaining({ localization: "ver-mac-loc-en" }),
    ]);
  });

  it("uploads the lead size of a shared display type and lists the other size as skipped", async () => {
    const { projectPath, keyPath } = await fixture();
    await addScreens(
      projectPath,
      { id: "pad", name: "Pad", device: "ipad", artboard: { width: 1032, height: 1376 } },
      { id: "pad-129", name: "Pad 12.9", device: "ipad", storeTargetId: "12.9", artboard: { width: 1024, height: 1366 } },
    );
    const reason = "12.9 (2048x2732) and 13 (2064x2752) both fill APP_IPAD_PRO_3GEN_129, which takes one size; 13 is uploaded";

    const dry = await runAppStoreUploadCommand({ project: projectPath, store: "apple", "dry-run": "true" }, storeSpecsPath, dependencies());
    expect(dry.output).toContain("IOS en-US APP_IPAD_PRO_3GEN_129: upload pad (replaces every current screenshot)");
    expect(dry.output).toContain(`Skipped 1, apple/ipad 12.9: ${reason}`);

    const deps = dependencies();
    const { output, exitCode } = await runAppStoreUploadCommand({ project: projectPath, store: "apple", "key-path": keyPath, json: "true" }, storeSpecsPath, deps);
    expect(exitCode).toBe(0);
    expect(JSON.parse(output).skipped).toEqual(expect.arrayContaining([
      { screenId: "pad-129", platform: "apple", device: "ipad", sizeId: "12.9", reason },
    ]));
    expect(deps.exportBundle.mock.calls[0]![0].entries.map(({ screen }) => screen.id)).not.toContain("pad-129");
    expect(asc.screenshots.get("set-en-ipad")).toHaveLength(1);
  });

  it("reports a set failed when its creation is rejected, and changes nothing else", async () => {
    const { projectPath, keyPath } = await fixture();
    asc.sets = [];
    asc.fail = [{ method: "POST", path: "/appScreenshotSets" }];

    const { output, exitCode } = await runAppStoreUploadCommand({ project: projectPath, store: "apple", "key-path": keyPath }, storeSpecsPath, dependencies());

    expect(exitCode).toBe(1);
    expect(output).toContain("IOS en-US APP_IPHONE_61: upload hero, save-fast, stay-organized (replaces 0 current): failed (App Store Connect appScreenshotSets create failed: 409 The screenshot set cannot be changed now.)");
    expect(output).toContain("IOS de-DE APP_IPHONE_61: upload hero-de (replaces 0 current): untouched");
    expect(mutations()).toEqual(["POST /appScreenshotSets"]);
  });

  it("reports a set partial when an upload part times out", async () => {
    const { projectPath, keyPath } = await fixture();
    asc.stallUpload = "shot-1/1";

    const { output, exitCode } = await runAppStoreUploadCommand(
      { project: projectPath, store: "apple", "key-path": keyPath },
      storeSpecsPath,
      { ...dependencies(), requestTimeoutMs: 500 },
    );

    expect(exitCode).toBe(1);
    expect(output).toContain("(replaces 2 current): partial (App Store Connect screenshot upload failed: network error (timeout))");
    expect(asc.calls).not.toContain("PATCH /appScreenshots/shot-1");
    expectNoSecrets(output);
  });

  it("reports a set partial when processing does not finish in time", async () => {
    const { projectPath, keyPath } = await fixture();
    asc.neverComplete.add("shot-1");

    const { output, exitCode } = await runAppStoreUploadCommand(
      { project: projectPath, store: "apple", "key-path": keyPath },
      storeSpecsPath,
      { ...dependencies(), processingTimeoutMs: 30 },
    );

    expect(exitCode).toBe(1);
    expect(output).toContain(": partial (App Store Connect did not finish processing a screenshot in time)");
    expect(output).toMatch(/Replaced 0 of 2 screenshot sets$/);
  });

  it("reports an unreadable 2xx body without quoting it", async () => {
    const { projectPath, keyPath } = await fixture();
    asc.garble = "/appStoreVersions";
    const error = await runAppStoreUploadCommand({ project: projectPath, store: "apple", "key-path": keyPath }, storeSpecsPath, dependencies())
      .catch((caught: Error) => caught);
    expect((error as Error).message).toBe("App Store Connect appStoreVersions list failed: unreadable response");
  });

  it("stops before rendering when a planned locale has no localization", async () => {
    const { projectPath, keyPath } = await fixture();
    asc.localizations = [{ id: "loc-en", locale: "en-US" }];
    const deps = dependencies();
    await expect(runAppStoreUploadCommand({ project: projectPath, store: "apple", "key-path": keyPath }, storeSpecsPath, deps)).rejects.toThrow(
      /^App Store Connect has no localization for de-DE \(IOS 1\.2\); add the language in App Store Connect first\nNothing was changed/,
    );
    expect(deps.exportBundle).not.toHaveBeenCalled();
    expect(mutations()).toEqual([]);
  });

  it("reissues the token before it expires, never sooner, and never sends an expired one", async () => {
    const { projectPath, keyPath } = await fixture();
    let clock = Date.UTC(2026, 9, 31, 12);
    const sent: Array<{ at: number; exp: number }> = [];
    const deps = {
      ...dependencies(),
      now: () => (clock += 2 * 60_000),
      processingTimeoutMs: 60 * 60_000,
      fetch: ((input: string | URL | Request, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("authorization");
        if (authorization) sent.push({ at: clock / 1000, exp: decode(authorization.split(".")[1]!).exp as number });
        return fetch(input, init);
      }) as typeof fetch,
    };

    const { exitCode } = await runAppStoreUploadCommand({ project: projectPath, store: "apple", "key-path": keyPath }, storeSpecsPath, deps);

    expect(exitCode).toBe(0);
    expect(asc.tokens.length).toBeGreaterThan(2);
    for (const { claims } of asc.tokens) expect((claims.exp as number) - (claims.iat as number)).toBe(15 * 60);
    for (const { at, exp } of sent) expect(exp - at).toBeGreaterThanOrEqual(60);
    const issued = asc.tokens.map(({ claims }) => claims.iat as number);
    for (const [index, iat] of issued.slice(1).entries()) expect(iat - issued[index]!).toBeGreaterThanOrEqual(14 * 60);
  });

  it("stops at a rejected key without rendering, and keeps the key out of the error", async () => {
    const { projectPath, root } = await fixture();
    const otherKey = join(root, "other.p8");
    await writeFile(otherKey, generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }));
    const deps = dependencies();

    const error = await runAppStoreUploadCommand({ project: projectPath, store: "apple", "key-path": otherKey }, storeSpecsPath, deps)
      .catch((caught: Error) => caught);

    expect((error as Error).message).toBe(
      "App Store Connect appStoreVersions list failed: 401 Provide a properly configured and signed bearer token, and make sure that it has not expired.",
    );
    expect(deps.exportBundle).not.toHaveBeenCalled();
    expectNoSecrets((error as Error).message);

    const rsa = join(root, "rsa.p8");
    await writeFile(rsa, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }));
    await expect(runAppStoreUploadCommand({ project: projectPath, store: "apple", "key-path": rsa }, storeSpecsPath, deps))
      .rejects.toThrow(/^The App Store Connect API key file is not a P-256 EC key/);
    await writeFile(rsa, "not a key");
    await expect(runAppStoreUploadCommand({ project: projectPath, store: "apple", "key-path": rsa }, storeSpecsPath, deps))
      .rejects.toThrow(/^The App Store Connect API key file is not a valid PEM key$/);
  });

  it("prints the plan for --dry-run without credentials, rendering or network", async () => {
    const { projectPath } = await fixture();
    const deps = { ...dependencies(), env: {} };

    const { output, exitCode } = await runAppStoreUploadCommand({ project: projectPath, store: "apple", "dry-run": "true" }, storeSpecsPath, deps);

    expect(exitCode).toBe(0);
    expect(output.split("\n")).toEqual([
      `App Store Connect app ${APP_ID} (layout default)`,
      "IOS en-US APP_IPHONE_61: upload hero, save-fast, stay-organized (replaces every current screenshot)",
      "IOS de-DE APP_IPHONE_61: upload hero-de (replaces every current screenshot)",
      "Skipped 1, apple/iphone duo-inner: The App Store Connect API has no display type for iPhone Duo screenshots",
      "Dry run: App Store Connect was not contacted",
    ]);
    expect(asc.calls).toEqual([]);
    expect(deps.exportBundle).not.toHaveBeenCalled();
  });

  it("refuses under the agent marker, even with --dry-run", async () => {
    const { projectPath, keyPath } = await fixture();
    for (const flags of [{ "dry-run": "true" }, {}] as Array<Record<string, string>>) {
      await expect(runAppStoreUploadCommand(
        { project: projectPath, store: "apple", "key-path": keyPath, ...flags },
        storeSpecsPath,
        dependencies({ SCREENSHOT_STUDIO_AGENT: "1" }),
      )).rejects.toThrow(/human-only action and does not run in an agent session \(SCREENSHOT_STUDIO_AGENT is set\)/);
    }
    expect(asc.calls).toEqual([]);
  });

  it("requires the app id and all three key settings", async () => {
    const missing = await fixture(null);
    await expect(runAppStoreUploadCommand({ project: missing.projectPath, store: "apple", "dry-run": "true" }, storeSpecsPath, dependencies()))
      .rejects.toThrow(/screenshots publishing set --apple-app-id <id>/);
    const { projectPath, keyPath } = await fixture();
    await expect(runAppStoreUploadCommand({ project: projectPath, store: "apple" }, storeSpecsPath, dependencies()))
      .rejects.toThrow(/^Set APP_STORE_CONNECT_KEY_ID, APP_STORE_CONNECT_ISSUER_ID and APP_STORE_CONNECT_KEY_PATH \(or pass --key-path <path>\)/);
    await expect(runAppStoreUploadCommand({ project: projectPath, store: "apple", "key-path": keyPath }, storeSpecsPath, { ...dependencies(), env: { APP_STORE_CONNECT_KEY_ID: KEY_ID } }))
      .rejects.toThrow(/^Set APP_STORE_CONNECT_KEY_ID/);
    expect(asc.calls).toEqual([]);
  });
});
