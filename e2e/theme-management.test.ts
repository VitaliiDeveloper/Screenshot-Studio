// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { buildBundleEntries, inspectPng, parseStoreSpecs, type StoreSpecs } from "@screenshot-studio/core/export";
import { parseProjectJson } from "@screenshot-studio/core/model";
import { createProjectScaffold } from "@screenshot-studio/core/scaffold";
import { listBuiltInDesignPacks } from "@screenshot-studio/core/themes";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";
import { createRenderBrowserSession } from "@screenshot-studio/cli/render-driver";
import { exportBundle, withStableProjectExport } from "@screenshot-studio/cli/export";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/sample/assets");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;
let specs: StoreSpecs;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "theme-management-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  const sampleProject = JSON.parse(readFileSync(sample, "utf8"));
  specs = parseStoreSpecs(JSON.parse(readFileSync(resolve(repoRoot, "store-specs.json"), "utf8")));
  const project = createProjectScaffold({
    name: "Built-in starter theme",
    platform: "apple",
    device: "iphone",
    layoutMode: "isolated",
    templateId: "iphone-starter",
  }, specs).project;
  project.fonts = sampleProject.fonts;
  const headline = project.layouts[0].screens[0].elements.find((element: { role?: string }) => element.role === "heading");
  headline.name = "Theme headline";
  writeFileSync(projectFile, JSON.stringify(project));
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "themes"));
  writeFileSync(join(dir, "themes/midnight.json"), JSON.stringify({
    id: "midnight",
    name: "Midnight",
    colors: { heading: "#12ABCD", body: "#CBD5E1", accent: "#38BDF8", surface: "#0F172A" },
    fonts: { heading: { family: "Pacifico", weight: 400 } },
  }));
  process.env.PROJECT_PATH = projectFile;
  server = await startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function headline() {
  const project = JSON.parse(readFileSync(projectFile, "utf8"));
  return project.layouts[0].screens[0].elements.find((element: { role?: string }) => element.role === "heading");
}

function screens(): Array<{ id: string; background: unknown }> {
  return JSON.parse(readFileSync(projectFile, "utf8")).layouts[0].screens;
}

/** Export the lead screen through the shared CLI renderer and return its decoded PNG. */
async function exportLeadScreen(): Promise<PNG> {
  const project = parseProjectJson(readFileSync(projectFile, "utf8"));
  const entries = buildBundleEntries(project, project.preferredExportLayoutId, specs, {}).slice(0, 1);
  const outDir = join(dir, "export");
  const session = await createRenderBrowserSession();
  try {
    await withStableProjectExport(projectFile, (context) => exportBundle({
      baseUrl: server.url,
      projectPath: context.projectPath,
      projectRevision: context.revision,
      layoutId: project.preferredExportLayoutId,
      outDir,
      entries,
      renderSession: session,
      publicationGuard: context.publish,
    }));
  } finally {
    await session.close();
  }
  const png = readFileSync(join(outDir, entries[0]!.relativePath));
  const info = inspectPng(png);
  expect({ width: info.width, height: info.height, hasAlpha: info.hasAlpha })
    .toEqual({ width: entries[0]!.target.width, height: entries[0]!.target.height, hasAlpha: false });
  return PNG.sync.read(png);
}

function pixel(png: PNG, x: number, y: number): [number, number, number] {
  const offset = (png.width * y + x) * 4;
  return [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!];
}

function accent() {
  const project = JSON.parse(readFileSync(projectFile, "utf8"));
  return project.layouts[0].screens[0].elements.find((element: { role?: string }) => element.role === "accent");
}

describe("theme management UI", () => {
  it("visibly bakes a built-in pack into a built-in starter and preserves project themes", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    expect(headline()).toMatchObject({ role: "heading", color: "#FFFFFF" });
    expect(accent()).toMatchObject({ role: "accent", fill: "#38BDF8" });
    const beforePack = await page.getByTestId("editor-stage").screenshot();

    await page.getByRole("button", { name: /Design packs/ }).click();
    const builtInRow = page.getByTestId("design-pack-row-neutral-default");
    await builtInRow.waitFor({ state: "visible" });
    await builtInRow.getByRole("button", { name: "Apply pack", exact: true }).click();
    const pack = listBuiltInDesignPacks()[0]!;
    const starterSize = headline().size;
    await expect.poll(() => headline().color).toBe("#0F172A");
    expect(headline()).toMatchObject({
      role: "heading",
      fontFamily: "Screenshot Studio Sans",
      weight: 400,
      size: starterSize,
    });
    expect(accent()).toMatchObject({ role: "accent", fill: "#1D4ED8" });
    expect(screens()[0]!.background).toEqual(pack.background);
    expect(readFileSync(projectFile, "utf8")).not.toContain("neutral-default");

    await page.waitForTimeout(100);
    const afterPack = await page.getByTestId("editor-stage").screenshot();
    expect(afterPack.equals(beforePack)).toBe(false);

    await page.getByRole("button", { name: "Close design pack picker", exact: true }).click();

    // Exact-size CLI render: the light pack background reaches every corner and the heading is dark.
    const exported = await exportLeadScreen();
    for (const [x, y] of [[2, 2], [exported.width - 3, 2], [2, exported.height - 3], [exported.width - 3, exported.height - 3]] as const) {
      expect(Math.min(...pixel(exported, x, y)), `corner ${x},${y}`).toBeGreaterThanOrEqual(0xD0);
    }
    const box = headline();
    let darkest = 255;
    for (let y = box.y; y < box.y + box.height; y += 2) {
      for (let x = box.x; x < box.x + box.width; x += 2) darkest = Math.min(darkest, Math.max(...pixel(exported, x, y)));
    }
    expect(darkest).toBeLessThanOrEqual(0x40);

    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("canvas");
    expect(headline()).toMatchObject({ color: "#0F172A", size: starterSize });
    const structurePanel = page.getByRole("button", { name: "Layers panel", exact: true });
    if (await structurePanel.getAttribute("aria-pressed") !== "true") await structurePanel.click();
    await page.getByRole("button", { name: "Theme headline", exact: true }).click();
    expect(await page.getByRole("button", { name: "Theme role", exact: true }).textContent()).toContain("Heading");

    await page.getByRole("button", { name: /Design packs/ }).click();
    const row = page.getByTestId("theme-row-midnight");
    await row.waitFor({ state: "visible" });
    let releaseApply!: () => void;
    const applyGate = new Promise<void>((resolve) => { releaseApply = resolve; });
    await page.route("**/api/themes", async (route) => {
      if (route.request().method() === "POST") await applyGate;
      await route.continue();
    });
    await row.getByRole("button", { name: "Apply", exact: true }).click();
    const closeButton = page.getByRole("button", { name: "Close design pack picker", exact: true });
    try {
      await page.getByRole("button", { name: "Applying…", exact: true }).waitFor();
      expect(await closeButton.isDisabled()).toBe(true);
      await page.getByRole("dialog", { name: "Design pack picker" }).locator("..").click({ position: { x: 4, y: 4 } });
      expect(await page.getByRole("dialog", { name: "Design pack picker" }).isVisible()).toBe(true);
    } finally {
      releaseApply();
    }
    await expect.poll(() => headline().color).toBe("#12ABCD");
    expect(headline()).toMatchObject({ role: "heading", fontFamily: "Pacifico", weight: 400 });

    await page.getByRole("button", { name: "Close design pack picker", exact: true }).click();
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("canvas");
    const reloadedStructurePanel = page.getByRole("button", { name: "Layers panel", exact: true });
    if (await reloadedStructurePanel.getAttribute("aria-pressed") !== "true") await reloadedStructurePanel.click();
    await page.getByRole("button", { name: "Theme headline", exact: true }).click();
    expect(await page.getByRole("button", { name: "Theme role", exact: true }).textContent()).toContain("Heading");

    await page.getByRole("button", { name: /Design packs/ }).click();
    const screenPack = page.getByTestId("template-pack-row-neutral-iphone-basics");
    await screenPack.getByRole("button", { name: "Add screens from pack", exact: true }).click();
    await expect.poll(() => screens().length).toBe(3);
    expect(screens().slice(1).map((screen) => screen.background)).toEqual([pack.background, pack.background]);
    await page.getByRole("dialog", { name: "Design pack picker" }).waitFor({ state: "hidden" });
    await page.close();
  });
});
