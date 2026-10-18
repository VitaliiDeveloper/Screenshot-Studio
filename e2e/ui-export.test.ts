// SPDX-License-Identifier: Apache-2.0
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { parseProjectJson } from "@screenshot-studio/core/model";
import { buildBundleEntries, findStoreTarget, inspectPng, parseStoreSpecs } from "@screenshot-studio/core/export";
import { startWebServer } from "@screenshot-studio/cli/server";
import { selectExportEntries } from "../apps/web/lib/export-selection";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDir = resolve(repoRoot, "fixtures/regressions/multi-locale-export");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");
const expectedPaths = [
  "apple/iphone/locale-en/size-6.3/01-english-one-6.3.png",
  "apple/iphone/locale-~002e~002e~002far/size-6.3/01-arabic-one-6.3.png",
  "apple/iphone/locale-en/size-6.3/02-english-two-6.3.png",
  "apple/iphone/locale-~002e~002e~002far/size-6.3/02-arabic-two-6.3.png",
  "apple/ipad/locale-en/size-13/01-english-ipad-13.png",
  "android/phone/locale-en_~0055~0053/size-phone-portrait/01-underscore-android-phone-portrait.png",
];

afterEach(() => {
  delete process.env.PROJECT_PATH;
  delete process.env.STORE_SPECS_PATH;
});

describe("multi-locale UI export", () => {
  it("exports safe per-group-numbered paths with exact dims and no alpha", async () => {
    // Copy the whole fixture (assets resolve relative to the project dir) into a temp workspace and
    // point the server's resolveProjectPath at it. Browser export must not publish beside the project.
    const workspace = await mkdtemp(join(tmpdir(), "ui-export-"));
    const operationId = `export_${randomBytes(16).toString("hex")}`;
    await cp(fixtureDir, workspace, { recursive: true });
    const projectPath = join(workspace, "app-store-screenshots.json");
    process.env.PROJECT_PATH = projectPath;
    process.env.STORE_SPECS_PATH = storeSpecsPath;

    const project = parseProjectJson(await readFile(projectPath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const expected = buildBundleEntries(project, project.preferredExportLayoutId, specs, {});
    expect(expected.map((entry) => entry.relativePath)).toEqual(expectedPaths);

    let server: Awaited<ReturnType<typeof startWebServer>> | undefined;
    try {
      server = await startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") });
      const projectResponse = await fetch(`${server.url}/api/project`);
      expect(projectResponse.status).toBe(200);
      const projectId = projectResponse.headers.get("x-project-id");
      const revision = projectResponse.headers.get("etag");
      expect(projectId).toBeTruthy();
      expect(revision).toMatch(/^"[^"]+"$/);

      const exportRequest = fetch(`${server.url}/api/export`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": revision!,
          "x-project-id": projectId!,
        },
        body: JSON.stringify({ operationId }),
      });
      const observedProgress: Array<{ phase: string; completed: number; total: number }> = [];
      // Poll until a deadline, not an attempt count: CI runners render the bundle much slower.
      const progressDeadline = Date.now() + 120_000;
      while (Date.now() < progressDeadline) {
        const progressResponse = await fetch(
          `${server.url}/api/export/progress?operationId=${operationId}`,
          { cache: "no-store" },
        );
        if (progressResponse.ok) {
          const progress = await progressResponse.json() as {
            phase: string;
            completed: number;
            total: number;
          };
          observedProgress.push(progress);
          if (progress.phase === "ready") break;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      const res = await exportRequest;
      if (res.status !== 201) throw new Error(`UI export failed (${res.status}): ${await res.text()}`);
      expect(observedProgress.some((progress) => (
        progress.phase === "rendering" && progress.completed > 0 && progress.total === expected.length
      ))).toBe(true);
      expect(observedProgress.at(-1)?.phase).toBe("ready");
      const ticket = await res.json() as {
        downloadUrl: string;
        expiresAt: string;
        filename: string;
      };
      expect(ticket.downloadUrl).toMatch(/^\/api\/export\/artifacts\/[A-Za-z0-9_-]{43}$/);
      expect(Date.parse(ticket.expiresAt)).toBeGreaterThan(Date.now());
      expect(ticket.filename).toBe("app-store-screenshots-bundle.zip");
      await expect(access(join(workspace, "export"))).rejects.toMatchObject({ code: "ENOENT" });

      const download = await fetch(new URL(ticket.downloadUrl, server.url));
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe("application/zip");
      expect(download.headers.get("content-disposition"))
        .toBe('attachment; filename="app-store-screenshots-bundle.zip"');

      const zip = await JSZip.loadAsync(Buffer.from(await download.arrayBuffer()));
      const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort();
      expect(names).toEqual([...expectedPaths].sort());

      for (const entry of expected) {
        const png = await zip.file(entry.relativePath)!.async("nodebuffer");
        const info = inspectPng(png);
        expect(info.width).toBe(entry.target.width);
        expect(info.height).toBe(entry.target.height);
        expect(info.hasAlpha).toBe(false);
      }

      const consumed = await fetch(new URL(ticket.downloadUrl, server.url));
      expect(consumed.status).toBe(404);
      expect(await consumed.json()).toEqual({ error: "Export artifact not found" });
    } finally {
      await server?.stop();
      await rm(workspace, { recursive: true, force: true });
    }
  }, 180_000);

  it("sends the dialog's checked sizes and locales and shows the exported and failed files", async () => {
    // The source-checkout dev host reloads an open editor while the render host runs an export, so
    // the real export runs from Node and the dialog's request is answered with its result.
    const workspace = await mkdtemp(join(tmpdir(), "ui-export-dialog-"));
    await cp(fixtureDir, workspace, { recursive: true });
    const projectPath = join(workspace, "app-store-screenshots.json");
    const project = parseProjectJson(await readFile(projectPath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const all = buildBundleEntries(project, project.preferredExportLayoutId, specs);
    const expected = all.filter((entry) => entry.screen.device === "iphone");
    const selection = { sizes: ["apple/iphone/6.3"], locales: ["../ar", "en"] };

    let server: Awaited<ReturnType<typeof startWebServer>> | undefined;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      server = await startWebServer(undefined, { projectPath, storeSpecsPath });
      const projectResponse = await fetch(`${server.url}/api/project`);
      const exported = await fetch(`${server.url}/api/export`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": projectResponse.headers.get("etag")!,
          "x-project-id": projectResponse.headers.get("x-project-id")!,
        },
        body: JSON.stringify(selection),
      });
      if (exported.status !== 201) throw new Error(`UI export failed (${exported.status}): ${await exported.text()}`);
      const result = await exported.json() as Record<string, unknown>;
      expect(result).toMatchObject({ written: 4, total: 4, failures: [], stopped: false });
      // Compile the routes the dialog calls before the editor opens; a first compile reloads it too.
      expect((await fetch(`${server.url}/api/export/progress?operationId=export_${"0".repeat(32)}`)).status).toBe(404);
      expect((await fetch(`${server.url}/api/export/artifacts/${"a".repeat(43)}`)).status).toBe(404);

      browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, acceptDownloads: true });
      await page.goto(`${server.url}/editor`, { waitUntil: "load" });
      await page.waitForSelector("canvas");
      await page.getByRole("button", { name: /^Export(, \d+ files?)?$/ }).click();
      const dialog = page.getByRole("dialog", { name: "Export" });
      const destinations = dialog.getByRole("list", { name: "Destinations" });
      await destinations.waitFor();

      for (const entry of all) {
        const target = findStoreTarget(specs, entry.screen.platform, entry.screen.device, entry.target.id);
        expect(await destinations.textContent()).toContain(`${target.width} × ${target.height}`);
      }
      // The engine reports screens missing in ../ar (iPad) and en_US; while checked they block export.
      await dialog.getByText(/blockers stop this export/u).waitFor();
      expect(await dialog.getByRole("button", { name: "Export 6 files" }).isDisabled()).toBe(true);

      await dialog.getByRole("list", { name: "Locales" }).getByRole("checkbox", { name: /^en_US/u }).uncheck();
      await destinations.getByRole("checkbox", { name: /iPad 13/u }).uncheck();
      const exportButton = dialog.getByRole("button", { name: `Export ${expected.length} files` });
      await expect.poll(() => exportButton.isEnabled()).toBe(true);
      expect(await dialog.getByRole("list", { name: "Path preview" }).textContent())
        .toBe(expected.slice(0, 2).map((entry) => entry.relativePath).join(""));

      let requested: { sizes: string[]; locales: string[] } | undefined;
      let releaseExport!: () => void;
      const exportHeld = new Promise<void>((resolveHold) => { releaseExport = resolveHold; });
      await page.route("**/api/export", async (route) => {
        requested = route.request().postDataJSON() as typeof requested;
        await exportHeld;
        await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(result) });
      });
      const downloadPromise = page.waitForEvent("download");
      await exportButton.click();
      await dialog.getByRole("button", { name: "Stop" }).waitFor();
      await page.keyboard.press("Escape");
      // Longer than the dialog's close animation, so a started close would have finished.
      await new Promise((resolveWait) => setTimeout(resolveWait, 400));
      expect(await dialog.isVisible()).toBe(true);
      releaseExport();

      const download = await downloadPromise;
      expect(selectExportEntries(all, requested!).map((entry) => entry.relativePath))
        .toEqual(selectExportEntries(all, selection).map((entry) => entry.relativePath));
      expect(download.suggestedFilename()).toBe("app-store-screenshots-bundle.zip");
      await dialog.getByRole("status").filter({ hasText: "4 of 4 files exported" }).waitFor();
      const zip = await JSZip.loadAsync(await readFile((await download.path())!));
      const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort();
      expect(names).toEqual(expected.map((entry) => entry.relativePath).sort());
      for (const entry of expected) {
        const info = inspectPng(await zip.file(entry.relativePath)!.async("nodebuffer"));
        expect([info.width, info.height]).toEqual([entry.target.width, entry.target.height]);
        expect(info.hasAlpha).toBe(false);
      }

      const failed = expected[1]!;
      await page.unroute("**/api/export");
      await page.route("**/api/export", (route) => route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: "No file could be rendered",
          failures: [{ screenId: failed.screen.id, relativePath: failed.relativePath, message: "Render host timed out" }],
        }),
      }));
      await exportButton.click();
      const failedFiles = dialog.getByRole("list", { name: "Failed files" });
      await failedFiles.waitFor();
      expect(await failedFiles.textContent()).toContain(`${failed.relativePath}Render host timed out`);
      await failedFiles.getByRole("button", { name: `Go to ${failed.relativePath}` }).click();
      await dialog.waitFor({ state: "hidden" });
    } finally {
      await browser?.close();
      await server?.stop();
      await rm(workspace, { recursive: true, force: true });
    }
  }, 180_000);
});
