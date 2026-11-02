// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { link, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { AgentRenderRequest } from "@screenshot-studio/core/agent-render";
import { MISSING_CHROMIUM_MESSAGE } from "@screenshot-studio/cli/render-driver";
import { runRenderJob, type RenderJobContext } from "./agent-render-job.server.js";

const STORE_SPECS = resolve(fileURLToPath(new URL("../../../../store-specs.json", import.meta.url)));
const SECRET = "FAKE-KEY-BYTES-123";
const PROJECT = {
  meta: { name: "Job", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "primary",
  layouts: [{
    id: "primary", name: "Primary", mode: "isolated",
    screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 1206, height: 2622 }, background: { type: "solid", color: "#000000" }, elements: [],
    }],
  }],
};
const SINGLE: AgentRenderRequest = { command: "export", flags: { screen: "hero" } };
const BUNDLE: AgentRenderRequest = { command: "export", flags: {} };
const CHECK: AgentRenderRequest = { command: "check", flags: { render: true, json: true } };

let root: string;
let projectDir: string;
let projectFile: string;
let keyFile: string;
let png: Buffer;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "render-job-")));
  projectDir = join(root, "project");
  projectFile = join(projectDir, "app-store-screenshots.json");
  keyFile = join(root, "keys", "key.json");
  await mkdir(projectDir);
  await mkdir(join(root, "keys"));
  await writeFile(projectFile, JSON.stringify(PROJECT));
  await writeFile(keyFile, JSON.stringify({ private_key: SECRET }));
  png = await sharp({ create: { width: 1206, height: 2622, channels: 3, background: "#000000" } }).png().toBuffer();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function context(overrides: Partial<RenderJobContext> = {}): RenderJobContext {
  return {
    origin: "http://127.0.0.1:1",
    guard: (operation) => operation(),
    projectDir,
    isCancelled: () => false,
    storeSpecsPath: STORE_SPECS,
    exportScreenToPng: vi.fn(async () => png),
    createRenderBrowserSession: vi.fn(async () => ({
      renderScreenToPng: vi.fn(async () => png),
      close: vi.fn(async () => undefined),
    })),
    collectRenderedLayoutIssues: vi.fn(async () => []),
    ...overrides,
  };
}

const failure = (message: string) => ({ ok: false, message });

describe.skipIf(process.platform === "win32")("runRenderJob", () => {
  it("exports one screen into the project's export folder", async () => {
    const response = await runRenderJob(SINGLE, context());
    expect(response).toEqual({
      ok: true,
      output: `Exported ${join(projectDir, "export", "apple-iphone-6.3-locale-en.png")} (1206x2622)`,
      exitCode: 0,
    });
    expect((await readFile(join(projectDir, "export", "apple-iphone-6.3-locale-en.png"))).equals(png)).toBe(true);
  });

  it("exports a bundle into the same folder", async () => {
    const response = await runRenderJob(BUNDLE, context());
    expect(response).toMatchObject({ ok: true, exitCode: 0, output: expect.stringContaining(`to ${join(projectDir, "export")}`) });
    expect(await readdir(join(projectDir, "export"))).toContain("app-store-screenshots-bundle.zip");
  });

  it("runs check through this host and returns its report and exit code", async () => {
    const collect = vi.fn(async () => []);
    const response = await runRenderJob(CHECK, context({ collectRenderedLayoutIssues: collect }));
    expect(response).toMatchObject({ ok: true, exitCode: 0 });
    expect(JSON.parse((response as { output: string }).output)).toMatchObject({ textMeasured: true, ok: true });
    expect(collect).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "http://127.0.0.1:1", projectPath: projectFile }));
  });

  it("holds the guard for the whole job", async () => {
    const steps: string[] = [];
    const response = await runRenderJob(SINGLE, context({
      guard: async (operation) => {
        steps.push("guard in");
        const result = await operation();
        steps.push("guard out");
        return result;
      },
      onGuardHeld: () => steps.push("held"),
      exportScreenToPng: async () => {
        steps.push("render");
        return png;
      },
    }));
    expect(response.ok).toBe(true);
    expect(steps).toEqual(["guard in", "held", "render", "guard out"]);
  });

  it("answers a guard failure with the fixed text", async () => {
    class LifecycleChanged extends Error {}
    const response = await runRenderJob(SINGLE, context({ guard: async () => { throw new LifecycleChanged(SECRET); } }));
    expect(response).toEqual(failure(expect.stringContaining("could not read this project")));
    expect(JSON.stringify(response)).not.toContain(SECRET);
  });

  it("passes a mistake the agent can fix", async () => {
    await expect(runRenderJob({ command: "export", flags: { screen: "nope" } }, context()))
      .resolves.toEqual(failure(expect.stringContaining("nope")));
    await expect(runRenderJob({ command: "export", flags: { screen: "hero", size: "nope" } }, context()))
      .resolves.toEqual(failure(expect.stringContaining("nope")));
  });

  describe("the browser is pinned", () => {
    beforeEach(() => vi.stubEnv("SCREENSHOTS_BROWSER", "msedge"));

    it("for one screen", async () => {
      const exportScreen = vi.fn(async () => png);
      await expect(runRenderJob(SINGLE, context({ exportScreenToPng: exportScreen }))).resolves.toMatchObject({ ok: true });
      expect(exportScreen).toHaveBeenCalledWith(expect.objectContaining({ browser: "chromium" }));
    });

    it("for a bundle", async () => {
      const session = vi.fn(async () => ({ renderScreenToPng: async () => png, close: async () => undefined }));
      await expect(runRenderJob(BUNDLE, context({ createRenderBrowserSession: session }))).resolves.toMatchObject({ ok: true });
      expect(session).toHaveBeenCalledWith();
    });
  });

  describe("the project file is pinned", () => {
    it.each([["export", SINGLE], ["bundle", BUNDLE], ["check", CHECK]] as const)("%s refuses a link to a key file and quotes nothing", async (_name, request) => {
      await rm(projectFile);
      await symlink(keyFile, projectFile);
      const job = context();
      const response = await runRenderJob(request, job);
      expect(response).toEqual(failure(expect.stringContaining("must be a regular file")));
      expect(JSON.stringify(response)).not.toContain(SECRET);
      expect(job.exportScreenToPng).not.toHaveBeenCalled();
      expect(job.collectRenderedLayoutIssues).not.toHaveBeenCalled();
    });

    it("refuses a link to another project, so nothing is written beside it", async () => {
      const other = join(root, "other");
      await mkdir(other);
      await writeFile(join(other, "app-store-screenshots.json"), JSON.stringify(PROJECT));
      await rm(projectFile);
      await symlink(join(other, "app-store-screenshots.json"), projectFile);
      await expect(runRenderJob(SINGLE, context())).resolves.toMatchObject({ ok: false });
      expect(await readdir(other)).toEqual(["app-store-screenshots.json"]);
    });

    it("refuses a hard link to a key file", async () => {
      await rm(projectFile);
      await link(keyFile, projectFile);
      const response = await runRenderJob(CHECK, context());
      expect(response).toEqual(failure(expect.stringContaining("must be a regular file")));
      expect(JSON.stringify(response)).not.toContain(SECRET);
    });

    it.each([["export", SINGLE], ["check", CHECK]] as const)("%s never quotes an unparsable project, which is what a swapped-in key reads as", async (_name, request) => {
      await writeFile(projectFile, `{"private_key": ${SECRET}}`);
      const response = await runRenderJob(request, context());
      expect(JSON.stringify(response)).not.toContain(SECRET);
      expect(JSON.stringify(response)).toContain("could not read this project");
    });
  });

  describe("render errors never travel", () => {
    const renderHostError = new Error(`Render failed for screen "hero": Project file is not valid JSON: ${SECRET}`);

    it("from one screen", async () => {
      const response = await runRenderJob(SINGLE, context({ exportScreenToPng: async () => { throw renderHostError; } }));
      expect(response).toEqual(failure(expect.stringContaining("could not render")));
      expect(JSON.stringify(response)).not.toContain(SECRET);
    });

    it("from a bundle", async () => {
      const response = await runRenderJob(BUNDLE, context({
        createRenderBrowserSession: async () => ({ renderScreenToPng: async () => { throw renderHostError; }, close: async () => undefined }),
      }));
      expect(response).toEqual(failure(expect.stringContaining("could not render")));
      expect(JSON.stringify(response)).not.toContain(SECRET);
    });

    it("from check", async () => {
      const response = await runRenderJob(CHECK, context({ collectRenderedLayoutIssues: async () => { throw renderHostError; } }));
      expect(response).toEqual(failure(expect.stringContaining("could not render")));
      expect(JSON.stringify(response)).not.toContain(SECRET);
    });

    it("except the one that tells the user to install Chromium", async () => {
      await expect(runRenderJob(SINGLE, context({ exportScreenToPng: async () => { throw new Error(MISSING_CHROMIUM_MESSAGE); } })))
        .resolves.toEqual(failure(MISSING_CHROMIUM_MESSAGE));
    });
  });

  describe("the output folder is pinned", () => {
    const pointExportAt = async (target: string) => {
      await mkdir(target, { recursive: true });
      await symlink(target, join(projectDir, "export"));
    };

    it.each([["one screen", SINGLE], ["a bundle", BUNDLE]] as const)("%s refuses an export folder that links away", async (_name, request) => {
      const target = join(root, "keys");
      await pointExportAt(target);
      await expect(runRenderJob(request, context())).resolves.toMatchObject({ ok: false });
      expect(await readdir(target)).toEqual(["key.json"]);
    });

    it("a fastlane export never prunes through a link", async () => {
      const outside = join(root, "outside");
      const stale = join(outside, "screenshots", "en-US", "iphone-6.3-99.png");
      await mkdir(join(outside, "screenshots", "en-US"), { recursive: true });
      await writeFile(stale, "user's file");
      await mkdir(join(projectDir, "export"));
      await symlink(outside, join(projectDir, "export", "fastlane"));
      await expect(runRenderJob({ command: "export", flags: { profile: "fastlane" } }, context())).resolves.toMatchObject({ ok: false });
      expect(await readFile(stale, "utf8")).toBe("user's file");
      expect(await readdir(join(outside, "screenshots", "en-US"))).toEqual(["iphone-6.3-99.png"]);
    });

    it("a fastlane export still works in a real folder", async () => {
      await expect(runRenderJob({ command: "export", flags: { profile: "fastlane" } }, context())).resolves.toMatchObject({ ok: true });
      expect((await lstat(join(projectDir, "export", "fastlane"))).isDirectory()).toBe(true);
    });
  });

  describe("cancel", () => {
    it("runs nothing when the run ended while the job waited for the guard", async () => {
      const job = context({ isCancelled: () => true });
      await expect(runRenderJob(SINGLE, job)).resolves.toEqual(failure(expect.stringContaining("ended before")));
      expect(job.exportScreenToPng).not.toHaveBeenCalled();
    });

    it("publishes no screen rendered before a cancel", async () => {
      let cancelled = false;
      const response = await runRenderJob(SINGLE, context({
        isCancelled: () => cancelled,
        exportScreenToPng: async () => {
          cancelled = true;
          return png;
        },
      }));
      expect(response.ok).toBe(false);
      expect(existsSync(join(projectDir, "export"))).toBe(false);
    });

    it("publishes no partial bundle after a cancel", async () => {
      let cancelled = false;
      const project = structuredClone(PROJECT);
      project.layouts[0]!.screens.push({ ...project.layouts[0]!.screens[0]!, id: "second" });
      await writeFile(projectFile, JSON.stringify(project));
      const render = vi.fn(async () => {
        cancelled = true;
        return png;
      });
      const response = await runRenderJob(BUNDLE, context({
        isCancelled: () => cancelled,
        createRenderBrowserSession: async () => ({ renderScreenToPng: render, close: async () => undefined }),
      }));
      expect(response.ok).toBe(false);
      expect(render).toHaveBeenCalledTimes(1);
      expect(existsSync(join(projectDir, "export"))).toBe(false);
    });
  });

  it("answers a report over the response cap with a fixed message", async () => {
    const issue = { kind: "text-overflow", level: "blocker", id: "x", layoutId: "primary", screenId: "hero", elementId: "e".repeat(2000) };
    const response = await runRenderJob(CHECK, context({
      collectRenderedLayoutIssues: async () => Array.from({ length: 600 }, () => issue) as never,
    }));
    expect(response).toEqual(failure(expect.stringContaining("too large")));
  });
});
