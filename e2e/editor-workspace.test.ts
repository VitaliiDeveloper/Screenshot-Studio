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

function writeWorkspaceBaseline(): void {
  const baseline = JSON.parse(readFileSync(sample, "utf8")) as {
    platforms: string[];
    screens: Array<{ platform: string; device: string; variantOf?: string; storeTargetId?: string }>;
  };
  baseline.screens = baseline.screens.filter((screen) =>
    screen.platform === "apple"
    && screen.device === "iphone"
    && screen.variantOf === undefined
    && screen.storeTargetId === undefined,
  );
  baseline.platforms = ["apple"];
  writeFileSync(projectFile, `${JSON.stringify(baseline, null, 2)}\n`);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "workspace-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeWorkspaceBaseline();
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  process.env.PROJECT_PATH = projectFile;
  server = await startWebServer(3136, { storeSpecsPath: resolve(repoRoot, "store-specs.json") });
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
      platform: string;
      device: string;
      locale: string;
      variantOf?: string;
      storeTargetId?: string;
      artboard: { width: number; height: number };
      elements: Array<{ id: string; type: string; x: number; y: number; width: number; height: number }>;
    }>;
  };
}

describe("Phase 3.6 editor workspace", () => {
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

  it("creates an independent store-target variant without resizing the master", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    const masterBefore = structuredClone(project().screens[0]!);
    const addSize = page.getByRole("button", { name: "Add size", exact: true });
    await expect.poll(() => addSize.count(), { timeout: 5_000 }).toBe(1);
    await addSize.click();
    await page.getByRole("menuitem", { name: '6.5" iPhone', exact: true }).click();

    await expect.poll(() => project().screens.filter((screen) => screen.storeTargetId === "6.5").length, { timeout: 10_000 }).toBe(1);
    const persisted = project();
    const masterAfter = persisted.screens.find((screen) => screen.id === masterBefore.id)!;
    const variant = persisted.screens.find((screen) => screen.storeTargetId === "6.5")!;
    expect(masterAfter.artboard).toEqual(masterBefore.artboard);
    expect(masterAfter.elements).toEqual(masterBefore.elements);
    expect(variant).toMatchObject({
      variantOf: masterBefore.id,
      artboard: { width: 1284, height: 2778 },
    });
    expect(variant.id).not.toBe(masterBefore.id);
    expect(variant.elements[0]!.id).not.toBe(masterBefore.elements[0]!.id);
    expect(await page.getByRole("spinbutton", { name: "Width", exact: true }).count()).toBe(0);
    expect(await page.getByText("This variant uses fixed Store Target dimensions.", { exact: true }).count()).toBe(1);
    const targetRow = page.getByRole("group", { name: '6.5" iPhone store target', exact: true });
    await expect.poll(() => targetRow.getByRole("button", { name: "Current", exact: true }).count()).toBe(1);

    page.once("dialog", (dialog) => dialog.accept());
    await targetRow.getByRole("button", { name: "Remove", exact: true }).click();
    await expect.poll(() => project().screens.filter((screen) => screen.storeTargetId === "6.5").length, { timeout: 10_000 }).toBe(0);
    expect(project().screens.find((screen) => screen.id === masterBefore.id)!.artboard).toEqual(masterBefore.artboard);
    await page.close();
  });

  it("creates and opens an independent iPad output set without changing iPhone roots", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    const iphoneBefore = structuredClone(project().screens.filter((screen) =>
      screen.platform === "apple" && screen.device === "iphone" && screen.variantOf === undefined,
    ));
    const addOutput = page.getByRole("button", { name: "Add output", exact: true });
    await expect.poll(() => addOutput.count(), { timeout: 5_000 }).toBe(1);
    await addOutput.click();
    await page.getByRole("menuitem", { name: "App Store · iPad", exact: true }).click();

    await expect.poll(() => project().screens.filter((screen) => screen.device === "ipad").length, { timeout: 10_000 }).toBe(3);
    const persisted = project();
    const ipadRoots = persisted.screens.filter((screen) => screen.device === "ipad");
    expect(ipadRoots.every((screen) =>
      screen.variantOf === undefined
      && screen.artboard.width === 2064
      && screen.artboard.height === 2752
    )).toBe(true);
    expect(persisted.screens.filter((screen) => screen.device === "iphone" && screen.variantOf === undefined)).toEqual(iphoneBefore);
    const ipadOutput = page.getByRole("group", { name: "App Store · iPad output", exact: true });
    await expect.poll(() => ipadOutput.getByRole("button", { name: "Current", exact: true }).count()).toBe(1);

    const structureToggle = page.getByRole("button", { name: "Structure panel", exact: true });
    if ((await structureToggle.getAttribute("aria-pressed")) !== "true") await structureToggle.click();

    const outputFamily = page.getByRole("button", { name: "Output family for en", exact: true });
    await expect.poll(() => outputFamily.count()).toBe(1);
    expect(await outputFamily.textContent()).toContain("App Store / iPad · 3 screens");
    const outputFamilySurface = await outputFamily.evaluate((element) => {
      const triggerStyle = getComputedStyle(element);
      const surfaceStyle = getComputedStyle(element.parentElement?.parentElement ?? element);
      return {
        triggerBackground: triggerStyle.backgroundColor,
        triggerFontSize: getComputedStyle(element.querySelector("span") ?? element).fontSize,
        surfaceBackground: surfaceStyle.backgroundColor,
        paddingTop: surfaceStyle.paddingTop,
        paddingBottom: surfaceStyle.paddingBottom,
      };
    });
    expect(outputFamilySurface.triggerBackground).toBe("rgba(0, 0, 0, 0)");
    expect(outputFamilySurface.triggerFontSize).toBe("11px");
    expect(outputFamilySurface.surfaceBackground).not.toBe("rgba(0, 0, 0, 0)");
    expect(outputFamilySurface.paddingTop).toBe(outputFamilySurface.paddingBottom);

    await outputFamily.click();
    const outputOptions = page.getByRole("menu", { name: "Output family options for en", exact: true });
    await expect.poll(() => outputOptions.getByRole("menuitemradio").count()).toBe(2);
    expect(await outputOptions.evaluate((element) => getComputedStyle(element).animationName)).toBe("menu-select-in");
    expect(await outputOptions.getByRole("menuitemradio").first().evaluate((element) => element.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(40);
    expect(await outputOptions.getByRole("menuitemradio").first().evaluate((element) =>
      getComputedStyle(element.querySelector("span") ?? element).fontSize,
    )).toBe("11px");
    expect(await outputOptions.getByRole("menuitemradio", { name: "App Store · iPad · 3", exact: true })
      .getAttribute("aria-checked")).toBe("true");

    const ipadScreens = page.getByRole("list", { name: "Screens for en · App Store · iPad", exact: true });
    await expect.poll(() => ipadScreens.getByRole("listitem").count()).toBe(3);
    expect(await ipadScreens.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
    expect(await ipadScreens.evaluate((element) => getComputedStyle(element).maxHeight)).toBe("256px");
    expect(await page.getByRole("button", { name: "Hero · iphone", exact: true }).count()).toBe(0);

    await outputOptions.getByRole("menuitemradio", { name: "App Store · iPhone · 3", exact: true }).click();
    const iphoneScreens = page.getByRole("list", { name: "Screens for en · App Store · iPhone", exact: true });
    await expect.poll(() => iphoneScreens.getByRole("listitem").count()).toBe(3);
    expect(await page.getByRole("button", { name: "Hero · iphone", exact: true }).getAttribute("aria-current"))
      .toBe("true");
    expect(await outputFamily.textContent()).toContain("App Store / iPhone · 3 screens");
    expect(await page.getByTestId("overview-output-families").getByRole("region").count()).toBe(2);

    await outputFamily.click();
    await outputOptions.getByRole("menuitemradio", { name: "App Store · iPad · 3", exact: true }).click();

    const iphoneRow = page.getByRole("region", { name: "App Store · iPhone output row", exact: true });
    const ipadRow = page.getByRole("region", { name: "App Store · iPad output row", exact: true });
    const iphoneRowBox = (await iphoneRow.boundingBox())!;
    const ipadRowBox = (await ipadRow.boundingBox())!;
    expect(ipadRowBox.y).toBeGreaterThan(iphoneRowBox.y + iphoneRowBox.height);

    const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
    for (let step = 0; step < 5; step += 1) await zoomIn.click();
    const overflow = await page.getByTestId("canvas-viewport").evaluate((viewport) => ({
      horizontal: viewport.scrollWidth > viewport.clientWidth,
      vertical: viewport.scrollHeight > viewport.clientHeight,
    }));
    expect(overflow).toEqual({ horizontal: true, vertical: true });

    const additionalFamilies = [
      "App Store · macOS",
      "App Store · tvOS",
      "App Store · watchOS",
      "Google Play · Android phone",
      "Microsoft Store · Windows desktop",
    ];
    for (const label of additionalFamilies) {
      await page.getByRole("button", { name: "Add output", exact: true }).click();
      await page.getByRole("menuitem", { name: label, exact: true }).click();
      const family = page.getByRole("group", { name: `${label} output`, exact: true });
      await expect.poll(() => family.getByRole("button", { name: "Current", exact: true }).count(), {
        timeout: 10_000,
      }).toBe(1);
    }

    await expect.poll(() => page.getByTestId("overview-output-families").getByRole("region").count(), {
      timeout: 10_000,
    }).toBe(7);
    const cardGeometry = await page.getByTestId("overview-output-families")
      .locator("div[data-screen-id]")
      .evaluateAll((cards) => cards.map((card) => {
        const canvas = card.querySelector("canvas");
        const item = card.closest('[data-testid="artboard-preview-item"]');
        const label = item?.querySelector('[data-testid="artboard-preview-label"]');
        const caption = item?.querySelector('[data-testid="artboard-preview-caption"]');
        const metadataLabel = caption?.querySelector('[data-testid="artboard-preview-metadata"]');
        const cardRect = card.getBoundingClientRect();
        const canvasRect = canvas?.getBoundingClientRect();
        return {
          id: card.getAttribute("data-screen-id"),
          row: card.closest("section")?.getAttribute("aria-label") ?? "",
          cardTop: cardRect.top,
          cardWidth: cardRect.width,
          cardHeight: cardRect.height,
          canvasWidth: canvasRect?.width ?? 0,
          canvasHeight: canvasRect?.height ?? 0,
          labelHeight: label?.clientHeight ?? 0,
          labelScrollHeight: label?.scrollHeight ?? 0,
          captionHeight: caption?.clientHeight ?? 0,
          captionScrollHeight: caption?.scrollHeight ?? 0,
          metadataVisible: metadataLabel !== null,
        };
      }));
    expect(cardGeometry).toHaveLength(21);
    expect(cardGeometry.every((entry) =>
      Math.abs(entry.cardWidth - entry.canvasWidth) < 1
      && Math.abs(entry.cardHeight - entry.canvasHeight) < 1,
    )).toBe(true);
    expect(cardGeometry.every((entry) =>
      entry.labelHeight === 20 && entry.labelScrollHeight === entry.labelHeight,
    )).toBe(true);
    expect(cardGeometry.every((entry) =>
      entry.captionHeight === 20 && entry.captionScrollHeight === entry.captionHeight,
    )).toBe(true);
    expect(cardGeometry.every((entry) => entry.metadataVisible)).toBe(true);
    const rowTops = cardGeometry.reduce<Record<string, number[]>>((groups, entry) => {
      (groups[entry.row] ??= []).push(entry.cardTop);
      return groups;
    }, {});
    expect(Object.values(rowTops).every((tops) => {
      return Math.max(...tops) - Math.min(...tops) < 1;
    })).toBe(true);

    const iphoneOutput = page.getByRole("group", { name: "App Store · iPhone output", exact: true });
    await iphoneOutput.getByRole("button", { name: "Open", exact: true }).click();
    await expect.poll(() => iphoneOutput.getByRole("button", { name: "Current", exact: true }).count()).toBe(1);
    await page.close();
    writeWorkspaceBaseline();
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

  it("transitions between fitted Focus and Overview without a stale zoom frame", async () => {
    const page = await browser.newPage({ viewport: { width: 651, height: 998 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    const viewport = page.getByTestId("canvas-viewport");
    await expect.poll(() => viewport.getAttribute("data-initial-reveal")).toBe("running");
    await expect.poll(() => viewport.getAttribute("data-initial-reveal")).toBe("idle");
    const expectSettledView = async (expectedView: "focus" | "overview") => {
      await expect.poll(() => viewport.getAttribute("data-view")).toBe(expectedView);
      await expect.poll(() => viewport.getAttribute("data-fitted-view")).toBe(expectedView);
      await expect.poll(() => viewport.getAttribute("data-view-transition")).toBe("idle");
    };

    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect.poll(() => viewport.getAttribute("data-view-transition")).toBe("running");
    expect(await viewport.getAttribute("data-fitted-view")).toBe("focus");
    await expect.poll(() => viewport.evaluate((element) => {
      const content = element.querySelector('[data-testid="focus-artboard"]');
      return content?.getAnimations()[0]?.effect?.getTiming().duration ?? null;
    })).toBe(320);
    await expectSettledView("focus");

    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expectSettledView("focus");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    expect(await viewport.getAttribute("data-view-transition")).toBe("idle");
    await expectSettledView("overview");
    await page.close();
  });

  it("supports overview, extensible add, canvas patterns, zoom, and hand pan", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    // Overview is a projection of every isolated screen in export order.
    const screenAdd = page.getByRole("button", { name: "Add screen", exact: true });
    const baseScreenCount = project().screens.length;
    await screenAdd.click();
    await expect.poll(() => project().screens.length, { timeout: 10_000 }).toBe(baseScreenCount + 1);
    await screenAdd.click();
    await expect.poll(() => project().screens.length, { timeout: 10_000 }).toBe(baseScreenCount + 2);
    await expect.poll(() => page.getByTestId("overview-artboards").locator("canvas").count()).toBe(baseScreenCount + 2);

    // The creation catalog inserts schema-valid elements through the existing persistence path.
    await page.getByRole("button", { name: "Add element" }).click();
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
