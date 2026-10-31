// SPDX-License-Identifier: Apache-2.0
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageElement, createTextElement } from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { runCheckCommand, type CheckCommandDependencies, type CheckReport } from "./check-command.js";
import { dispatchCommand } from "./command-dispatch.js";

const storeSpecsPath = fileURLToPath(new URL("../../../store-specs.json", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function screen(id: string, name: string, locale: string, elements: unknown[] = [], overrides: object = {}) {
  return {
    id,
    name,
    platform: "apple",
    device: "iphone",
    locale,
    direction: "ltr",
    artboard: { width: 1206, height: 2622 },
    background: { type: "solid", color: "#ffffff" },
    elements,
    ...overrides,
  };
}

async function projectWith(screens: unknown[], extra: object = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "check-command-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets", "present.png"), "png");
  const path = join(root, "app-store-screenshots.json");
  await writeFile(path, JSON.stringify({
    meta: { name: "Check", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{ id: "default", name: "Default", mode: "isolated", screens }],
    ...extra,
  }));
  return path;
}

/** en has Hero and Details; de lacks Details; Details shows an image that is not in the folder. */
function brokenProject(): Promise<string> {
  return projectWith([
    screen("hero", "Hero", "en", [{ ...createImageElement({ assetUrl: "assets/present.png" }), id: "kept" }]),
    screen("details", "Details", "en", [{ ...createImageElement({ assetUrl: "assets/lost.png" }), id: "lost" }]),
    screen("hero-de", "Hero", "de"),
  ]);
}

function noBrowser(): Required<CheckCommandDependencies> {
  return {
    startWebServer: vi.fn(async () => { throw new Error("fast check started a server"); }),
    collectRenderedLayoutIssues: vi.fn(async () => { throw new Error("fast check launched a browser"); }),
  };
}

function parse(output: string): CheckReport {
  return JSON.parse(output) as CheckReport;
}

describe("screenshots check", () => {
  it("fails on a missing image and a screen missing in a locale without a browser", async () => {
    const project = await brokenProject();
    const dependencies = noBrowser();

    const result = await runCheckCommand({ project }, storeSpecsPath, dependencies);

    expect(result.exitCode).toBe(1);
    expect(result.output.split("\n")).toEqual([
      "blocker  missing-locale-screen  Screen \"Details\" missing in locale de  [screen=details size=6.3 locale=de]",
      "blocker  missing-image  Image missing from the project folder: assets/lost.png  [screen=details size=6.3 locale=en element=lost]",
      "2 blockers (text overflow not measured; run with --render)",
    ]);
    expect(dependencies.startWebServer).not.toHaveBeenCalled();
    expect(dependencies.collectRenderedLayoutIssues).not.toHaveBeenCalled();
  });

  it("emits a stable JSON report", async () => {
    const result = await runCheckCommand({ project: await brokenProject(), json: "true" }, storeSpecsPath, noBrowser());

    expect(parse(result.output)).toMatchInlineSnapshot(`
      {
        "counts": {
          "blockers": 2,
          "warnings": 0,
        },
        "issues": [
          {
            "elementId": null,
            "id": "missing-locale-screen:de:details",
            "kind": "missing-locale-screen",
            "layoutId": "default",
            "level": "blocker",
            "locale": "de",
            "message": "Screen "Details" missing in locale de",
            "screenId": "details",
            "size": "6.3",
          },
          {
            "elementId": "lost",
            "id": "missing-image:details:lost",
            "kind": "missing-image",
            "layoutId": "default",
            "level": "blocker",
            "locale": "en",
            "message": "Image missing from the project folder: assets/lost.png",
            "screenId": "details",
            "size": "6.3",
          },
        ],
        "layoutId": "default",
        "ok": false,
        "strict": false,
        "textMeasured": false,
      }
    `);
  });

  it("passes warnings unless --strict is set", async () => {
    const tablet = (id: string) => screen(id, id, "en", [], {
      platform: "android",
      device: "tablet-7",
      artboard: { width: 1440, height: 2560 },
    });
    const project = await projectWith([tablet("one"), tablet("two")]);

    const lenient = await runCheckCommand({ project, json: "true" }, storeSpecsPath, noBrowser());
    const strict = await runCheckCommand({ project, json: "true", strict: "true" }, storeSpecsPath, noBrowser());

    expect(lenient.exitCode).toBe(0);
    expect(parse(lenient.output).issues.map((issue) => [issue.kind, issue.level])).toEqual([
      ["android-tablet-screen-count", "warning"],
    ]);
    expect(strict.exitCode).toBe(1);
    expect(parse(strict.output)).toMatchObject({ ok: false, strict: true, counts: { blockers: 0, warnings: 1 } });
  });

  it("reports export preflight per screen: unknown sizes, unscalable artboards, fonts", async () => {
    const project = await projectWith([
      screen("hero", "Hero", "en", [{ ...createTextElement({}), id: "title", fontFamily: "Missing Sans" }]),
      screen("odd", "Odd", "en", [], { artboard: { width: 1000, height: 1000 } }),
      screen("ghost", "Ghost", "en", [], { storeTargetId: "no-such-size" }),
    ], { fonts: [{ family: "Gone", source: "uploaded", path: "assets/fonts/gone.ttf", weight: 400 }] });

    const result = await runCheckCommand({ project, json: "true" }, storeSpecsPath, noBrowser());

    expect(result.exitCode).toBe(1);
    expect(parse(result.output).issues.map((issue) => [issue.kind, issue.screenId, issue.size])).toEqual([
      ["unresolved-font", null, null],
      ["missing-font-file", null, null],
      ["artboard-size", "odd", "6.3"],
      ["unknown-size", "ghost", "no-such-size"],
    ]);
  });

  it("reports an invalid project as a blocker instead of throwing", async () => {
    const project = await projectWith([screen("hero", "Hero", "en", [], { unknownField: true })]);

    const result = await runCheckCommand({ project, json: "true" }, storeSpecsPath, noBrowser());

    expect(result.exitCode).toBe(1);
    expect(parse(result.output).issues).toEqual([expect.objectContaining({ kind: "invalid-project", level: "blocker" })]);
  });

  it("uses the render host's engine issues in place of the fast ones under --render", async () => {
    const project = await brokenProject();
    const rendered: ProjectIssue[] = [
      { kind: "missing-image", id: "missing-image:details:lost", level: "blocker", layoutId: "default", screenId: "details", elementId: "lost", assetUrl: "assets/lost.png" },
      { kind: "text-overflow", id: "text-overflow:hero:kept", level: "warning", layoutId: "default", screenId: "hero", elementId: "kept" },
    ];
    const stop = vi.fn(async () => undefined);
    const collect = vi.fn(async () => rendered);
    const dependencies: CheckCommandDependencies = {
      startWebServer: vi.fn(async () => ({ url: "http://render.test", stop, exited: new Promise<never>(() => {}) })) as never,
      collectRenderedLayoutIssues: collect,
    };

    const result = await runCheckCommand({ project, json: "true", render: "true" }, storeSpecsPath, dependencies);

    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "http://render.test", layoutId: "default" }));
    expect(stop).toHaveBeenCalledOnce();
    expect(parse(result.output)).toMatchObject({ textMeasured: true, counts: { blockers: 1, warnings: 1 } });
    expect(parse(result.output).issues.map((issue) => issue.id)).toEqual(rendered.map((issue) => issue.id));
  });

  it("skips text measurement while project fonts are broken", async () => {
    const project = await projectWith([screen("hero", "Hero", "en")], {
      fonts: [{ family: "Gone", source: "uploaded", path: "assets/fonts/gone.ttf", weight: 400 }],
    });
    const dependencies = noBrowser();

    const result = await runCheckCommand({ project, render: "true" }, storeSpecsPath, dependencies);

    expect(result.output).toContain("Text overflow was not measured: fix the font blockers first.");
    expect(dependencies.collectRenderedLayoutIssues).not.toHaveBeenCalled();
    const json = await runCheckCommand({ project, render: "true", json: "true" }, storeSpecsPath, dependencies);
    expect(parse(json.output)).toMatchObject({ textMeasured: false, ok: false });
  });

  it("fails on the same per-screen inputs as export: unsafe paths, and counts unscalable tablets", async () => {
    const tablet = (id: string, artboard = { width: 1440, height: 2560 }) =>
      screen(id, id, "en", [], { platform: "android", device: "tablet-7", artboard });
    const tablets = await projectWith([tablet("one"), tablet("odd", { width: 1000, height: 1000 })]);
    const longLocale = await projectWith([screen("long", "Long", "x".repeat(200))]);

    const report = parse((await runCheckCommand({ project: tablets, json: "true" }, storeSpecsPath, noBrowser())).output);
    const unsafe = parse((await runCheckCommand({ project: longLocale, json: "true" }, storeSpecsPath, noBrowser())).output);

    expect(report.issues.map((issue) => [issue.kind, issue.screenId])).toEqual([
      ["artboard-size", "odd"],
      ["android-tablet-screen-count", null],
    ]);
    expect(report.issues[1]!.message).toContain("has 2 screens");
    expect(unsafe.issues.map((issue) => [issue.kind, issue.screenId])).toEqual([["export-path", "long"]]);
  });

  it("checks the layout named by --layout and rejects an unknown one", async () => {
    const project = await projectWith([], {
      layouts: [
        { id: "default", name: "Default", mode: "isolated", screens: [screen("hero", "Hero", "en")] },
        {
          id: "campaign",
          name: "Campaign",
          mode: "isolated",
          screens: [screen("promo", "Promo", "en", [{ ...createImageElement({ assetUrl: "assets/lost.png" }), id: "lost" }])],
        },
      ],
    });

    const fallback = parse((await runCheckCommand({ project, json: "true" }, storeSpecsPath, noBrowser())).output);
    const campaign = parse((await runCheckCommand({ project, json: "true", layout: "campaign" }, storeSpecsPath, noBrowser())).output);

    expect(fallback).toMatchObject({ layoutId: "default", ok: true });
    expect(campaign).toMatchObject({ layoutId: "campaign", ok: false });
    expect(campaign.issues.map((issue) => issue.id)).toEqual(["missing-image:promo:lost"]);
    await expect(runCheckCommand({ project, layout: "nope" }, storeSpecsPath, noBrowser())).rejects.toThrow(/nope/);
  });
});

describe("check dispatch", () => {
  const missingBrowsers = (overrides: object = {}) => ({
    interactive: false,
    playwrightVersion: "9.9.9",
    detect: vi.fn(() => ({ missing: true as const, cacheDir: "/cache/ms-playwright" })),
    install: vi.fn(async () => undefined),
    confirm: vi.fn(async () => true),
    log: vi.fn(),
    ...overrides,
  });

  it("never probes browsers for the fast check and sets the exit code", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const browserSetup = missingBrowsers();

    await dispatchCommand("check", ["--project", await brokenProject()], { storeSpecsPath, browserSetup });

    expect(browserSetup.detect).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("fails --render without Chromium exactly like export", async () => {
    const project = await brokenProject();
    const exportFailure = dispatchCommand("export", ["--project", project], { storeSpecsPath, browserSetup: missingBrowsers() });
    const checkFailure = dispatchCommand("check", ["--project", project, "--render"], { storeSpecsPath, browserSetup: missingBrowsers() });

    const exportError = await exportFailure.catch((error: Error) => error.message);
    expect(exportError).toContain("Chromium");
    await expect(checkFailure).rejects.toThrow(exportError as string);
  });
});
