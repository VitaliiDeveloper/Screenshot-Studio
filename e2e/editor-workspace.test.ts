// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/sample/assets");

let server: RunningServer;
let browser: Browser;
let page: Page | undefined;
let dir: string;
let projectFile: string;

function writeWorkspaceBaseline(): void {
  const baseline = JSON.parse(readFileSync(sample, "utf8")) as {
    layouts: Array<{
      mode: "isolated" | "connected";
      screens: Array<{ platform: string; device: string; variantOf?: string; storeTargetId?: string }>;
    }>;
  };
  const layout = baseline.layouts[0]!;
  layout.screens = layout.screens.filter((screen) =>
    screen.platform === "apple"
    && screen.device === "iphone"
    && screen.variantOf === undefined
    && screen.storeTargetId === undefined,
  );
  layout.mode = "isolated";
  writeFileSync(projectFile, `${JSON.stringify(baseline, null, 2)}\n`);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "workspace-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeWorkspaceBaseline();
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  server = await startWebServer(undefined, {
    projectPath: projectFile,
    storeSpecsPath: resolve(repoRoot, "store-specs.json"),
  });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

function project() {
  const root = JSON.parse(readFileSync(projectFile, "utf8")) as { layouts: Array<{
    screenSetPolicies?: Array<{
      platform: string;
      device: string;
      locale: string;
      mode: "independent" | "synchronized";
    }>;
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
  }> };
  return root.layouts[0]!;
}

async function openEditor(viewport: { width: number; height: number }): Promise<Page> {
  page = await browser.newPage({ viewport });
  await page.goto(`${server.url}/editor`, { waitUntil: "load" });
  await page.waitForSelector("canvas");
  return page;
}

beforeEach(() => {
  writeWorkspaceBaseline();
  expect(project().screens).toHaveLength(3);
});

afterEach(async () => {
  try {
    await page?.close();
  } finally {
    page = undefined;
    writeWorkspaceBaseline();
  }
});

describe("editor workspace", () => {
  it("surfaces store-spec failures and recovers through the visible workspace retry", async () => {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let attempts = 0;
    await page.route("**/api/store-specs", async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ apple: { iphone: [{ id: "broken-target" }] } }),
        });
        return;
      }
      if (attempts === 2) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "store specs temporarily unavailable" }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const retryButton = page.getByRole("button", { name: "Retry workspace resources" });
    await retryButton.waitFor({ state: "visible" });
    const alert = page.getByRole("alert").filter({ has: retryButton });
    expect(await alert.textContent()).toMatch(/width|invalid|expected/i);
    await retryButton.click();
    await expect.poll(() => alert.textContent()).toContain("store specs temporarily unavailable");
    expect(await alert.textContent()).toContain("store specs temporarily unavailable");
    await retryButton.click();
    await page.waitForSelector("canvas");
    await alert.waitFor({ state: "hidden" });
    expect(attempts).toBe(3);
  });

  it("shows only the active screen's layers and updates them when screen selection changes", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });

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
  });

  it("adds an independent store-target row without leaving the master output", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });

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
    expect(await page.getByText("Artboard", { exact: true }).count()).toBe(1);
    const artboardMode = page.getByRole("group", { name: "Artboard size mode" });
    expect(await artboardMode.getByRole("button", { name: "Use Store size" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(await page.getByText("1320 × 2868 px", { exact: true }).count()).toBe(1);
    const targetRow = page.getByRole("group", { name: '6.5" iPhone store target', exact: true });
    const leadTargetRow = page.getByRole("group", { name: '6.9" iPhone (lead) store target', exact: true });
    await expect.poll(() => targetRow.getByRole("button", { name: 'Open 6.5" iPhone', exact: true }).count()).toBe(1);
    expect(await leadTargetRow.getByText('6.9" iPhone', { exact: true }).count()).toBe(1);
    expect(await leadTargetRow.getByText('6.9" iPhone (lead)', { exact: true }).count()).toBe(0);

    const outputFamilies = page.getByTestId("overview-output-family");
    await expect.poll(() => outputFamilies.count()).toBe(1);
    const iphoneOutput = outputFamilies.filter({ has: page.getByText("App Store · iPhone", { exact: true }) });
    expect(await iphoneOutput.getAttribute("data-editing")).toBe("true");
    const sizeRows = iphoneOutput.getByTestId("overview-size-row");
    await expect.poll(() => sizeRows.count()).toBe(2);
    const masterSizeRow = iphoneOutput.locator('[data-testid="overview-size-row"][data-size-kind="master"]');
    const variantSizeRow = iphoneOutput.locator('[data-testid="overview-size-row"][data-size-kind="variant"]');
    expect(await iphoneOutput.getByText('6.9"', { exact: true }).count()).toBe(1);
    expect(await iphoneOutput.getByText('6.9" iPhone (lead)', { exact: true }).count()).toBe(0);
    expect(await masterSizeRow.getAttribute("data-editing")).toBe("true");
    expect(await variantSizeRow.count()).toBe(1);
    expect(await variantSizeRow.getAttribute("data-editing")).toBe("false");
    expect(await variantSizeRow.getByTestId("output-identity-role").textContent()).toBe("variant");
    expect(await iphoneOutput.getByTestId("output-identity-role").first().textContent()).toBe("master");

    await targetRow.getByRole("button", { name: 'Open 6.5" iPhone', exact: true }).click();
    await expect.poll(() => page.getByText("1284 × 2778 px", { exact: true }).count()).toBe(1);
    expect(await artboardMode.getByRole("button", { name: "Use Store size" }).getAttribute("aria-pressed"))
      .toBe("true");
    await artboardMode.getByRole("button", { name: "Use custom artboard size" }).click();
    expect(await page.getByRole("spinbutton", { name: "W", exact: true }).inputValue()).toBe("1284");
    expect(await page.getByRole("spinbutton", { name: "H", exact: true }).inputValue()).toBe("2778");
    expect(await page.getByText(
      "Apply resizes every screen in this Store Target output and fits each composition.",
      { exact: true },
    ).count()).toBe(1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await targetRow.getAttribute("aria-current")).toBe("true");
    expect(await targetRow.getByText("Current", { exact: true }).count()).toBe(0);
    expect(await iphoneOutput.getAttribute("data-editing")).toBe("true");
    expect(await masterSizeRow.getAttribute("data-editing")).toBe("false");
    expect(await variantSizeRow.getAttribute("data-editing")).toBe("true");
    expect(await variantSizeRow.getByText("Editing", { exact: true }).count()).toBe(1);

    await leadTargetRow.getByRole("button", { name: 'Open 6.9" iPhone (lead)', exact: true }).click();
    const siblingMaster = project().screens.find((candidate) => (
      candidate.variantOf === undefined
      && candidate.platform === masterBefore.platform
      && candidate.device === masterBefore.device
      && candidate.locale === masterBefore.locale
      && candidate.id !== masterBefore.id
    ))!;
    await page.getByRole("button", {
      name: `${siblingMaster.name} · ${siblingMaster.device}`,
      exact: true,
    }).click();
    await expect.poll(() => targetRow.count()).toBe(1);
    expect(await targetRow.getByRole("button", { name: 'Open 6.5" iPhone', exact: true }).count()).toBe(1);
    expect(await targetRow.getByRole("button", {
      name: 'Remove 6.5" iPhone variant',
      exact: true,
    }).count()).toBe(1);
    await targetRow.getByRole("button", { name: 'Open 6.5" iPhone', exact: true }).click();

    await targetRow.getByRole("button", { name: 'Remove 6.5" iPhone variant', exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Remove size variant?", exact: true });
    const confirmationBox = await confirmation.boundingBox();
    expect(confirmationBox).not.toBeNull();
    expect(Math.abs(confirmationBox!.x + confirmationBox!.width / 2 - 720)).toBeLessThan(2);
    const confirmButton = confirmation.getByRole("button", { name: "Remove size", exact: true });
    expect((await confirmButton.boundingBox())!.height).toBeLessThanOrEqual(32);
    await confirmButton.click();
    await expect.poll(() => project().screens.filter((screen) => screen.storeTargetId === "6.5").length, { timeout: 10_000 }).toBe(0);
    expect(project().screens.find((screen) => screen.id === masterBefore.id)!.artboard).toEqual(masterBefore.artboard);
  });

  it("adds a new screen to the exact store-target variant being edited", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });

    await page.getByRole("button", { name: "Add size", exact: true }).click();
    await page.getByRole("menuitem", { name: '6.5" iPhone', exact: true }).click();
    const targetRow = page.getByRole("group", { name: '6.5" iPhone store target', exact: true });
    await targetRow.getByRole("button", { name: 'Open 6.5" iPhone', exact: true }).click();
    await expect.poll(() => page.getByRole("list", { name: "Screens for en · iphone" })
      .getByRole("listitem").count()).toBe(1);

    await page.getByRole("button", { name: "Add screen", exact: true }).click();
    await page.getByRole("menuitem", { name: "Blank screen", exact: true }).click();

    await expect.poll(() => project().screens.filter((screen) => screen.storeTargetId === "6.5").length, {
      timeout: 10_000,
    }).toBe(2);
    const persisted = project();
    expect(persisted.screens.filter((screen) => screen.variantOf === undefined)).toHaveLength(3);
    const addedVariant = persisted.screens.find((screen) => (
      screen.storeTargetId === "6.5" && screen.name === "Untitled"
    ));
    expect(addedVariant).toMatchObject({
      device: "iphone",
      variantOf: expect.any(String),
      artboard: { width: 1284, height: 2778 },
      elements: [],
    });
    expect(persisted.screens.find((screen) => screen.id === addedVariant!.variantOf)).toMatchObject({
      name: "Save Fast",
      device: "iphone",
      artboard: { width: 1320, height: 2868 },
    });
    await expect.poll(() => page.getByRole("list", { name: "Screens for en · iphone" })
      .getByRole("listitem").count()).toBe(2);
    expect(await page.getByRole("button", { name: "Untitled · iphone", exact: true })
      .getAttribute("aria-current")).toBe("true");
    expect(await targetRow.getAttribute("aria-current")).toBe("true");
  });

  it("keeps screen slots one-to-one only when synchronization is enabled", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });

    await page.getByRole("button", { name: "Add size", exact: true }).click();
    await page.getByRole("menuitem", { name: '6.5" iPhone', exact: true }).click();
    const targetRow = page.getByRole("group", { name: '6.5" iPhone store target', exact: true });
    await targetRow.getByRole("button", { name: 'Open 6.5" iPhone', exact: true }).click();
    await expect.poll(() => project().screens.filter((screen) => screen.storeTargetId === "6.5").length, {
      timeout: 10_000,
    }).toBe(1);

    const slotBehavior = page.getByRole("group", { name: "Screen slot behavior", exact: true });
    await slotBehavior.getByRole("button", { name: "Keep 1:1", exact: true }).click();
    await expect.poll(() => project().screenSetPolicies?.[0]?.mode, { timeout: 10_000 })
      .toBe("synchronized");
    await expect.poll(() => project().screens.filter((screen) => screen.storeTargetId === "6.5").length, {
      timeout: 10_000,
    }).toBe(3);

    await page.getByRole("button", { name: "Add screen", exact: true }).click();
    await page.getByRole("menuitem", { name: "Blank screen", exact: true }).click();

    await expect.poll(() => ({
      primary: project().screens.filter((screen) => screen.storeTargetId === undefined).length,
      exact: project().screens.filter((screen) => screen.storeTargetId === "6.5").length,
    }), { timeout: 10_000 }).toEqual({ primary: 4, exact: 4 });
    const persisted = project();
    const primaryIds = persisted.screens
      .filter((screen) => screen.storeTargetId === undefined)
      .map((screen) => screen.id);
    expect(persisted.screens
      .filter((screen) => screen.storeTargetId === "6.5")
      .map((screen) => screen.variantOf)).toEqual(primaryIds);
  });

  it("creates and opens an independent iPad output set without changing iPhone roots", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });

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
    await expect.poll(() => ipadOutput.getAttribute("aria-current")).toBe("true");

    const structureToggle = page.getByRole("button", { name: "Structure panel", exact: true });
    if ((await structureToggle.getAttribute("aria-pressed")) !== "true") await structureToggle.click();

    expect(await page.getByRole("button", { name: "Output family for en", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /Open Store Outputs for/ }).count()).toBe(0);

    const outputFamilies = page.getByTestId("overview-output-family");
    await expect.poll(() => outputFamilies.count()).toBe(2);
    expect(await page.locator('[data-testid="overview-output-family"][data-editing="true"]').count()).toBe(1);
    const activeOutputRow = outputFamilies.filter({ hasText: "App Store · iPad" });
    expect(await activeOutputRow.getAttribute("data-editing")).toBe("true");
    const inactiveOutputRows = page.locator('[data-testid="overview-output-family"][data-editing="false"]');
    expect(await inactiveOutputRows.count()).toBe(1);

    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await expect.poll(() => page.locator('[data-editor-side-panel="right"]').getAttribute("data-state"))
      .toBe("closed");
    await page.getByRole("button", { name: "Inspect", exact: true }).click();
    const storeOutputs = page.getByTestId("store-outputs-section");
    await storeOutputs.waitFor({ state: "visible" });
    await expect.poll(() => storeOutputs.getByText("Store outputs", { exact: true }).count()).toBe(1);

    const ipadScreens = page.getByRole("list", { name: "Screens for en · ipad", exact: true });
    await expect.poll(() => ipadScreens.getByRole("listitem").count()).toBe(3);
    expect(await ipadScreens.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
    expect(await ipadScreens.evaluate((element) => getComputedStyle(element).maxHeight)).toBe("256px");
    expect(await page.getByRole("button", { name: "Hero · iphone", exact: true }).count()).toBe(0);

    const iphoneOutput = storeOutputs.getByRole("group", { name: "App Store · iPhone output", exact: true });
    await iphoneOutput.getByRole("button", { name: "Open App Store · iPhone output", exact: true }).click();
    const iphoneScreens = page.getByRole("list", { name: "Screens for en · iphone", exact: true });
    await expect.poll(() => iphoneScreens.getByRole("listitem").count()).toBe(3);
    expect(await page.getByRole("button", { name: "Hero · iphone", exact: true }).getAttribute("aria-current"))
      .toBe("true");
    expect(await page.getByRole("button", { name: "Hero · ipad", exact: true }).count()).toBe(0);
    expect(await page.getByTestId("overview-output-families").getByRole("region").count()).toBe(2);

    await ipadOutput.getByRole("button", { name: "Open App Store · iPad output", exact: true }).click();

    const iphoneRow = page.getByRole("region", { name: "App Store · iPhone output", exact: true });
    const ipadRow = page.getByRole("region", { name: "App Store · iPad output", exact: true });
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
      await expect.poll(() => family.getAttribute("aria-current"), {
        timeout: 10_000,
      }).toBe("true");
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
          row: card.closest('[data-testid="overview-output-family"]')?.getAttribute("aria-label") ?? "",
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

    const finalIphoneOutput = page.getByRole("group", { name: "App Store · iPhone output", exact: true });
    await finalIphoneOutput.getByRole("button", { name: "Open App Store · iPhone output", exact: true }).click();
    await expect.poll(() => finalIphoneOutput.getAttribute("aria-current")).toBe("true");
  });

  it("fits the complete three-screen overview and preserves Space activation on controls", async () => {
    const page = await openEditor({ width: 1800, height: 1000 });

    const fit = page.getByRole("button", { name: "Fit", exact: true });
    await fit.click();
    const viewportBox = (await page.getByTestId("canvas-viewport").boundingBox())!;
    const artboards = page.getByTestId("overview-artboards").locator("[data-screen-id]");
    await expect.poll(() => artboards.count()).toBe(3);
    const previewItems = page.getByTestId("artboard-preview-item");
    expect(await previewItems.count()).toBe(3);
    for (let index = 0; index < 3; index += 1) {
      const box = (await artboards.nth(index).boundingBox())!;
      const item = previewItems.nth(index);
      const titleBox = (await item.getByTestId("artboard-preview-label").boundingBox())!;
      const metadataBox = (await item.getByTestId("artboard-preview-caption").boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(viewportBox.x + 68);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width - 68);
      expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(box.y);
      expect(metadataBox.y).toBeGreaterThanOrEqual(box.y + box.height);
    }

    const secondScreen = project().screens[1]!;
    const inactiveArtboard = page.getByRole("button", { name: `Edit ${secondScreen.name}`, exact: true });
    await inactiveArtboard.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", {
      name: `${secondScreen.name} · ${secondScreen.device}`,
      exact: true,
    }).getAttribute("aria-current")).toBe("true");

    const focus = page.getByRole("button", { name: "Focus", exact: true });
    await focus.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => focus.getAttribute("aria-pressed")).toBe("true");
    const overview = page.getByRole("button", { name: "Overview", exact: true });
    await overview.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => overview.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps a fitted isolated output frame locked to its artwork width", async () => {
    const baseline = JSON.parse(readFileSync(projectFile, "utf8")) as {
      layouts: Array<{ screens: unknown[] }>;
    };
    baseline.layouts[0]!.screens = baseline.layouts[0]!.screens.slice(0, 1);
    writeFileSync(projectFile, `${JSON.stringify(baseline, null, 2)}\n`);

    const page = await openEditor({ width: 903, height: 998 });
    await page.getByRole("button", { name: "Fit", exact: true }).click();

    const geometry = await page.getByRole("region", {
      name: "App Store · iPhone output",
      exact: true,
    }).evaluate((family) => {
      const artwork = family.querySelector<HTMLElement>('[data-testid="artboard-preview-item"]');
      return {
        familyWidth: family.getBoundingClientRect().width,
        artworkWidth: artwork?.getBoundingClientRect().width ?? 0,
      };
    });

    expect(Math.abs(geometry.familyWidth - geometry.artworkWidth)).toBeLessThan(1);
  });

  it("transitions between fitted Focus and Overview without a stale zoom frame", async () => {
    const page = await openEditor({ width: 651, height: 998 });

    const viewport = page.getByTestId("canvas-viewport");
    await expect.poll(async () => {
      const state = await viewport.getAttribute("data-initial-reveal");
      return state === "running" || state === "idle";
    }).toBe(true);
    const revealCleanupMinimumOpacity = viewport.evaluate(async (element) => {
      const content = element.querySelector<HTMLElement>('[data-testid="overview-artboards"]');
      if (!content) return 0;
      if (element.getAttribute("data-initial-reveal") === "idle") {
        return Number.parseFloat(getComputedStyle(content).opacity);
      }
      let reachedFinalOpacity = false;
      let minimumOpacity = 1;
      let settledFrames = 0;
      while (settledFrames < 2) {
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
        const opacity = Number.parseFloat(getComputedStyle(content).opacity);
        if (opacity >= 0.99) reachedFinalOpacity = true;
        if (reachedFinalOpacity) minimumOpacity = Math.min(minimumOpacity, opacity);
        settledFrames = element.getAttribute("data-initial-reveal") === "idle"
          ? settledFrames + 1
          : 0;
      }
      return minimumOpacity;
    });
    await expect.poll(() => viewport.getAttribute("data-initial-reveal")).toBe("idle");
    expect(await revealCleanupMinimumOpacity).toBeGreaterThanOrEqual(0.99);
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
  });

  it("supports overview, extensible add, canvas patterns, zoom, and hand pan", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });

    // Overview is a projection of every isolated screen in export order.
    const screenAdd = page.getByRole("button", { name: "Add screen", exact: true });
    const duplicateCurrent = page.getByRole("menu", { name: "Add screen options", exact: true })
      .getByRole("menuitem", { name: "Duplicate current", exact: true });
    const baseScreenCount = project().screens.length;
    await screenAdd.click();
    await duplicateCurrent.click();
    await expect.poll(() => project().screens.length, { timeout: 10_000 }).toBe(baseScreenCount + 1);
    await screenAdd.click();
    await duplicateCurrent.click();
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
  });

  it("keeps compact Structure free of output navigation and opens outputs through Inspect", async () => {
    const page = await openEditor({ width: 720, height: 900 });

    const structure = page.getByRole("button", { name: "Structure panel", exact: true });
    const inspect = page.getByRole("button", { name: "Inspect", exact: true });
    await expect.poll(() => structure.getAttribute("aria-pressed")).toBe("false");
    await structure.click();
    await expect.poll(() => structure.getAttribute("aria-pressed")).toBe("true");
    expect(await inspect.getAttribute("aria-pressed")).toBe("false");

    expect(await page.getByRole("button", { name: /Open Store Outputs for/ }).count()).toBe(0);
    await inspect.click();
    await expect.poll(() => structure.getAttribute("aria-pressed")).toBe("false");
    await expect.poll(() => inspect.getAttribute("aria-pressed")).toBe("true");

    const storeOutputs = page.getByTestId("store-outputs-section");
    await storeOutputs.waitFor({ state: "visible" });
    const inspector = page.getByRole("heading", { name: "Inspector", exact: true })
      .locator("xpath=ancestor::aside");
    await expect.poll(async () => {
      const [inspectorBox, storeOutputsBox] = await Promise.all([
        inspector.boundingBox(),
        storeOutputs.boundingBox(),
      ]);
      return inspectorBox !== null
        && storeOutputsBox !== null
        && storeOutputsBox.y >= inspectorBox.y
        && storeOutputsBox.y + storeOutputsBox.height <= inspectorBox.y + inspectorBox.height;
    }, { timeout: 5_000 }).toBe(true);

  });

  it("keeps canvas controls inside the available compact workspace", async () => {
    const page = await openEditor({ width: 1440, height: 900 });

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
    await expect.poll(() => page.locator('[data-editor-side-panel="right"]').getAttribute("data-state"))
      .toBe("closed");
    await page.getByRole("button", { name: "Structure panel", exact: true }).click();
    expect(await page.getByLabel("Zoom controls").count()).toBe(0);
    const phonePanel = await page.getByRole("heading", { name: "Structure", exact: true }).locator("..")
      .locator("xpath=ancestor::aside").boundingBox();
    expect(phonePanel).not.toBeNull();
    expect(phonePanel!.x + phonePanel!.width).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "Structure panel", exact: true }).click();
    expect(await page.getByLabel("Zoom controls").count()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
