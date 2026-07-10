// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/phase-0-sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/phase-0-sample/assets");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "workspace-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeFileSync(projectFile, readFileSync(sample, "utf8"));
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  process.env.PROJECT_PATH = projectFile;
  server = await startWebServer(3136);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function project() {
  return JSON.parse(readFileSync(projectFile, "utf8")) as {
    screens: Array<{
      id: string;
      name: string;
      device: string;
      elements: Array<{ id: string; type: string; x: number; y: number; width: number; height: number }>;
    }>;
  };
}

describe("Phase 3.6 editor workspace", () => {
  it("keeps demo headline selection boxes clear of their supporting-copy layers", () => {
    const pairs = [
      ["headline", "hero-support"],
      ["save-fast-headline", "save-fast-support"],
      ["organized-headline", "organized-support"],
    ] as const;
    const elements = project().screens.flatMap((screen) => screen.elements);
    for (const [headlineId, supportId] of pairs) {
      const headline = elements.find((element) => element.id === headlineId)!;
      const support = elements.find((element) => element.id === supportId)!;
      expect(headline.y + headline.height).toBeLessThan(support.y);
    }
  });

  it("shows only the active screen's layers and updates them when screen selection changes", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    const currentProject = project();
    const firstScreen = currentProject.screens[0]!;
    const secondScreen = currentProject.screens[1]!;

    const structureToggle = page.getByRole("button", { name: "Structure panel", exact: true });
    if ((await structureToggle.getAttribute("aria-pressed")) !== "true") {
      await structureToggle.click();
    }
    const firstLayers = page.getByRole("list", { name: `Layers for ${firstScreen.name}` });
    await firstLayers.waitFor({ state: "visible" });
    await expect.poll(() => firstLayers.getByRole("listitem").count()).toBe(firstScreen.elements.length);

    await page.getByRole("button", { name: `${secondScreen.name} · ${secondScreen.device}`, exact: true }).click();
    const secondLayers = page.getByRole("list", { name: `Layers for ${secondScreen.name}` });
    await secondLayers.waitFor({ state: "visible" });
    await expect.poll(() => secondLayers.getByRole("listitem").count()).toBe(secondScreen.elements.length);
    expect(await page.getByRole("button", { name: `Show ${firstScreen.name} layers` }).count()).toBe(0);
    await page.close();
  });

  it("fits the complete three-screen overview and preserves Space activation on controls", async () => {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    const fit = page.getByRole("button", { name: "Fit", exact: true });
    await fit.click();
    const viewportBox = (await page.getByTestId("canvas-viewport").boundingBox())!;
    const artboards = page.getByTestId("overview-artboards").locator("[data-screen-id]");
    await expect.poll(() => artboards.count()).toBe(3);
    for (let index = 0; index < 3; index += 1) {
      const box = (await artboards.nth(index).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(viewportBox.x + 68);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width - 68);
    }

    const focus = page.getByRole("button", { name: "Focus", exact: true });
    await focus.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => focus.getAttribute("aria-pressed")).toBe("true");
    const overview = page.getByRole("button", { name: "Overview", exact: true });
    await overview.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => overview.getAttribute("aria-pressed")).toBe("true");
    await page.close();
  });

  it("supports overview, extensible add, canvas patterns, zoom, and hand pan", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    // Overview is a projection of every isolated screen in export order.
    const screenAdd = page.getByRole("button", { name: "Add", exact: true });
    const baseScreenCount = project().screens.length;
    await screenAdd.click();
    await expect.poll(() => project().screens.length, { timeout: 10_000 }).toBe(baseScreenCount + 1);
    await screenAdd.click();
    await expect.poll(() => project().screens.length, { timeout: 10_000 }).toBe(baseScreenCount + 2);
    await expect.poll(() => page.getByTestId("overview-artboards").locator("canvas").count()).toBe(baseScreenCount + 2);

    // The creation catalog inserts schema-valid elements through the existing persistence path.
    await page.getByRole("button", { name: "Add panel" }).click();
    const activeIndex = project().screens.length - 1;
    const activeBefore = project().screens[activeIndex]!.elements.length;
    await page.getByRole("button", { name: "+ Shape" }).click();
    await expect.poll(() => project().screens[activeIndex]!.elements.length, { timeout: 10_000 }).toBe(activeBefore + 1);

    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press("t");
    await expect.poll(() => project().screens[activeIndex]!.elements.length, { timeout: 10_000 }).toBe(activeBefore + 2);
    expect(project().screens[activeIndex]!.elements.at(-1)!.type).toBe("text");

    const viewport = page.getByTestId("canvas-viewport");
    const patternTrigger = page.getByRole("button", { name: "Canvas background: Dots" });
    await patternTrigger.click();
    const patternMenu = page.getByRole("menu", { name: "Canvas background" });
    await expect.poll(() => patternMenu.isVisible()).toBe(true);
    await expect.poll(() => page.getByRole("menuitemradio", { name: "Dots" })
      .evaluate((node) => document.activeElement === node)).toBe(true);
    await page.keyboard.press("ArrowDown");
    const gridPattern = page.getByRole("menuitemradio", { name: "Grid" });
    await expect.poll(() => gridPattern.evaluate((node) => document.activeElement === node)).toBe(true);
    await page.keyboard.press("Enter");
    await expect.poll(() => viewport.getAttribute("data-pattern")).toBe("grid");
    const updatedPatternTrigger = page.getByRole("button", { name: "Canvas background: Grid" });
    await expect.poll(() => updatedPatternTrigger.evaluate((node) => document.activeElement === node)).toBe(true);
    await updatedPatternTrigger.click();
    await expect.poll(() => gridPattern.getAttribute("aria-checked")).toBe("true");
    await page.keyboard.press("Escape");
    await expect.poll(() => patternMenu.isVisible()).toBe(false);
    await expect.poll(() => updatedPatternTrigger.evaluate((node) => document.activeElement === node)).toBe(true);

    const zoomControls = page.getByLabel("Zoom controls");
    const percent = zoomControls.locator("button").filter({ hasText: "%" });
    const beforeZoom = await percent.textContent();
    await viewport.dispatchEvent("wheel", { deltaY: -120, ctrlKey: true });
    await expect.poll(() => percent.textContent()).not.toBe(beforeZoom);

    await page.getByRole("button", { name: "Focus" }).click();
    await expect.poll(() => page.getByTestId("focus-artboard").locator("canvas").count()).toBe(1);
    await page.getByRole("button", { name: "Overview" }).click();

    await percent.click(); // reset to 100%, making the overview scrollable
    await page.getByRole("button", { name: "Hand tool" }).click();
    const box = await viewport.boundingBox();
    expect(box).not.toBeNull();
    const beforePan = await viewport.evaluate((node) => (node as HTMLElement).scrollTop);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 140, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => viewport.evaluate((node) => (node as HTMLElement).scrollTop)).not.toBe(beforePan);

    await zoomControls.getByRole("button", { name: "Fit" }).click();
    await expect.poll(async () => Number.parseInt((await percent.textContent()) ?? "100", 10)).toBeLessThan(100);
    await page.close();
  });

  it("keeps canvas controls inside the available compact workspace", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    expect(await page.getByRole("button", { name: "Inspect", exact: true }).getAttribute("aria-pressed")).toBe("true");
    expect(await page.getByRole("button", { name: "Structure panel", exact: true }).getAttribute("aria-pressed")).toBe("true");
    await page.setViewportSize({ width: 720, height: 900 });
    await expect.poll(() => page.getByRole("button", { name: "Inspect", exact: true }).getAttribute("aria-pressed")).toBe("false");
    await expect.poll(() => page.getByRole("button", { name: "Structure panel", exact: true }).getAttribute("aria-pressed")).toBe("false");

    const viewportBox = await page.getByTestId("canvas-viewport").boundingBox();
    const controlsBox = await page.getByLabel("Zoom controls").boundingBox();
    expect(viewportBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(controlsBox!.x).toBeGreaterThanOrEqual(viewportBox!.x);
    expect(controlsBox!.x + controlsBox!.width).toBeLessThanOrEqual(viewportBox!.x + viewportBox!.width);

    await page.getByRole("button", { name: "Structure panel", exact: true }).click();
    expect(await page.getByRole("button", { name: "Inspect", exact: true }).getAttribute("aria-pressed")).toBe("false");
    const layers = page.getByRole("list", { name: /^Layers for / });
    await layers.waitFor({ state: "visible" });
    const layersBox = await layers.boundingBox();
    expect(layersBox).not.toBeNull();
    expect(layersBox!.x).toBeGreaterThanOrEqual(0);
    expect(layersBox!.x + layersBox!.width).toBeLessThanOrEqual(720);

    await page.getByRole("button", { name: "Inspect", exact: true }).click();
    expect(await page.getByRole("button", { name: "Structure panel", exact: true }).getAttribute("aria-pressed")).toBe("false");
    const shiftedControls = await page.getByLabel("Zoom controls").boundingBox();
    expect(shiftedControls).not.toBeNull();
    expect(shiftedControls!.x).toBeGreaterThanOrEqual(viewportBox!.x);
    expect(shiftedControls!.x + shiftedControls!.width).toBeLessThanOrEqual(viewportBox!.x + viewportBox!.width - 288);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.getByRole("button", { name: "Inspect", exact: true }).getAttribute("aria-pressed")).toBe("false");
    await page.getByRole("button", { name: "Structure panel", exact: true }).click();
    expect(await page.getByLabel("Zoom controls").count()).toBe(0);
    const phonePanel = await page.getByRole("heading", { name: "Structure", exact: true }).locator("..")
      .locator("xpath=ancestor::aside").boundingBox();
    expect(phonePanel).not.toBeNull();
    expect(phonePanel!.x + phonePanel!.width).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "Structure panel", exact: true }).click();
    expect(await page.getByLabel("Zoom controls").count()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.close();
  });
});
