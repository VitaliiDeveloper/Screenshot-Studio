// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/regressions/connected-canvas/app-store-screenshots.json");

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "connected-workspace-"));
  projectPath = join(directory, "app-store-screenshots.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    layouts: Array<{
      id: string;
      name: string;
      mode: "isolated" | "connected";
      screens: Array<{
        id: string;
        name: string;
        platform: string;
        device: string;
        elements: unknown[];
        variantOf?: string;
        storeTargetId?: string;
      }>;
    }>;
  };
  const connectedLayout = fixture.layouts[0]!;
  const ipad = connectedLayout.screens.find((screen) => screen.id === "unrelated")!;
  ipad.platform = "apple";
  ipad.device = "ipad";
  const isolatedScreen = structuredClone(connectedLayout.screens[0]!);
  isolatedScreen.id = "isolated-hero";
  isolatedScreen.name = "Isolated Hero";
  isolatedScreen.elements = [];
  delete isolatedScreen.variantOf;
  delete isolatedScreen.storeTargetId;
  fixture.layouts.push({
    id: "isolated-campaign",
    name: "Isolated campaign",
    mode: "isolated",
    screens: [isolatedScreen],
  });
  writeFileSync(projectPath, `${JSON.stringify(fixture, null, 2)}\n`);
  server = await startWebServer(undefined, {
    projectPath,
    storeSpecsPath: resolve(repoRoot, "store-specs.json"),
  });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  rmSync(directory, { recursive: true, force: true });
});

function project() {
  return JSON.parse(readFileSync(projectPath, "utf8")).layouts
    .find((layout: { id: string }) => layout.id === "default");
}

function bridgeX(): number {
  return project().screens.find((screen: { id: string }) => screen.id === "connected-first")
    .elements.find((element: { id: string }) => element.id === "bridge").x;
}

async function dragBridge(page: Page, logicalDeltaX: number) {
  const canvas = page.getByTestId("connected-artboards").locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  const scale = box.width / 1320;
  const x = box.x + 700 * scale;
  const y = box.y + 300 * scale;
  await page.mouse.click(x, y);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + logicalDeltaX * scale, y, { steps: 8 });
  await page.mouse.up();
}

async function waitForConnectedWorkspace(page: Page) {
  const connected = page.getByTestId("connected-artboards");
  try {
    await connected.waitFor({ state: "visible" });
  } catch (error) {
    const alerts = await page.getByRole("alert").allTextContents();
    throw new Error(`Connected workspace did not load. Alerts: ${alerts.join(" | ")}`, {
      cause: error,
    });
  }
  return connected;
}

describe("connected workspace", () => {
  it("keeps group scope, owner surfaces, thumbnails, history, snapping, and layout switching coherent", async () => {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const connected = await waitForConnectedWorkspace(page);
    const rows = page.getByTestId("overview-output-row");
    await expect.poll(() => rows.count()).toBe(2);
    const iphoneRow = rows.filter({ hasText: "App Store · iPhone" });
    const ipadRowButton = page.getByRole("button", {
      name: "Edit App Store · iPad connected row",
      exact: true,
    });
    expect(await page.locator('[data-testid="overview-output-row"][data-editing="true"]').count()).toBe(1);
    expect(await iphoneRow.getAttribute("data-editing")).toBe("true");
    expect(await iphoneRow.getByText("Editing", { exact: true }).count()).toBe(1);
    expect(await ipadRowButton.getAttribute("data-editing")).toBe("false");
    const inactiveRows = page.locator('[data-testid="overview-output-row"][data-editing="false"]');
    expect(await inactiveRows.count()).toBe(1);
    expect(await inactiveRows.getByText("Editing", { exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: /Open Store Outputs for/ }).count()).toBe(0);

    const jsonBeforeNavigation = readFileSync(projectPath, "utf8");
    const iphonePixelsBefore = await iphoneRow.locator("canvas").first()
      .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
    await ipadRowButton.click();
    const ipadRow = rows.filter({ hasText: "App Store · iPad" });
    await expect.poll(() => ipadRow.getAttribute("data-editing")).toBe("true");
    await page.getByRole("list", { name: "Screens for en · ipad" }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: /^Layers · Unrelated \d+$/ }).waitFor({ state: "visible" });
    await page.getByText("540 × 960 px", { exact: true }).waitFor({ state: "visible" });
    const ipadConnected = page.getByTestId("connected-artboards");
    const ipadConnectedBox = (await ipadConnected.boundingBox())!;
    const ipadStageBox = (await ipadConnected.getByTestId("editor-stage").boundingBox())!;
    const ipadRowBox = (await ipadRow.boundingBox())!;
    expect(ipadConnectedBox.width).toBeCloseTo(ipadStageBox.width, 1);
    expect(ipadRowBox.width).toBeCloseTo(ipadConnectedBox.width, 1);
    expect(readFileSync(projectPath, "utf8")).toBe(jsonBeforeNavigation);

    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect.poll(() => page.getByTestId("focus-artboard").locator("canvas").count()).toBe(1);
    expect(await page.getByTestId("editor-stage").getAttribute("data-stage-screen-ids")).toBe("unrelated");
    await page.getByRole("button", { name: "Overview", exact: true }).click();

    const iphoneRowButton = page.getByRole("button", {
      name: "Edit App Store · iPhone connected row",
      exact: true,
    });
    await iphoneRowButton.click();
    const iphonePixelsAfter = await page.getByTestId("connected-artboards").locator("canvas").first()
      .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
    expect(iphonePixelsAfter).toBe(iphonePixelsBefore);
    expect(readFileSync(projectPath, "utf8")).toBe(jsonBeforeNavigation);

    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const overviewViewportBox = (await page.getByTestId("canvas-viewport").boundingBox())!;
    for (const row of await rows.all()) {
      const box = (await row.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(overviewViewportBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(overviewViewportBox.x + overviewViewportBox.width);
      expect(box.y).toBeGreaterThanOrEqual(overviewViewportBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(overviewViewportBox.y + overviewViewportBox.height);
    }

    const previewTitles = connected.getByTestId("artboard-preview-label");
    const previewMetadata = connected.getByTestId("artboard-preview-caption");
    expect(await previewTitles.allTextContents()).toEqual(["Connected First", "Connected Second"]);
    expect(await previewMetadata.allTextContents()).toEqual(["iphone · en", "iphone · en"]);
    const stage = connected.getByTestId("editor-stage");
    expect(await stage.getAttribute("data-stage-screen-ids"))
      .toBe("connected-first connected-second");

    const screens = page.getByRole("list", { name: "Screens for en · iphone" });
    await screens.waitFor({ state: "visible" });
    expect(await screens.getByRole("listitem").count()).toBe(2);
    expect(await page.getByRole("button", { name: "Unrelated · phone", exact: true }).count()).toBe(0);

    expect(await page.getByRole("button", { name: "Undo" }).isDisabled()).toBe(true);
    const activeLayout = page.getByRole("button", { name: "Active layout: Default" });
    const bytesBeforeLayoutSwitch = readFileSync(projectPath, "utf8");
    await activeLayout.click();
    await page.getByRole("menuitemradio", { name: /Isolated campaign/ }).click();
    await page.getByRole("button", { name: "Active layout: Isolated campaign" }).waitFor();
    await expect.poll(() => page.getByTestId("connected-artboards").count()).toBe(0);
    expect(readFileSync(projectPath, "utf8")).toBe(bytesBeforeLayoutSwitch);

    await page.reload({ waitUntil: "load" });
    await page.getByRole("button", { name: "Active layout: Isolated campaign" }).waitFor();
    expect(readFileSync(projectPath, "utf8")).toBe(bytesBeforeLayoutSwitch);
    await page.getByRole("button", { name: "Active layout: Isolated campaign" }).click();
    await page.getByRole("menuitemradio", { name: /Default/ }).click();
    await waitForConnectedWorkspace(page);
    expect(await page.getByRole("button", { name: "Undo" }).isDisabled()).toBe(true);

    const secondButton = screens.getByRole("button", { name: "Connected Second · iphone" });
    const secondThumbnail = secondButton.locator("xpath=..").locator("img");
    const originalThumbnail = await secondThumbnail.getAttribute("src");
    expect(originalThumbnail).toMatch(/^data:image\/png/);

    await dragBridge(page, 60);
    await expect.poll(bridgeX).toBeCloseTo(620, 0);
    await expect.poll(() => secondThumbnail.getAttribute("src")).not.toBe(originalThumbnail);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(bridgeX).toBe(560);
    await expect.poll(() => secondThumbnail.getAttribute("src")).toBe(originalThumbnail);

    await dragBridge(page, -160);
    await expect.poll(() => Math.abs(bridgeX() - 400) < 4).toBe(true);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(bridgeX).toBe(560);

    await secondButton.click();
    await expect.poll(() => secondButton.getAttribute("aria-current")).toBe("true");
    await expect.poll(() => stage.getAttribute("data-active-screen-id")).toBe("connected-second");
    await page.getByRole("heading", { name: /^Layers · Connected Second \d+$/ }).waitFor({ state: "visible" });
    expect(await page.getByRole("list", { name: "Layers for Connected Second" })
      .getByRole("listitem").count()).toBe(1);

    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const stageBox = (await stage.boundingBox())!;
    const connectedBox = (await connected.boundingBox())!;
    const viewportBox = (await page.getByTestId("canvas-viewport").boundingBox())!;
    expect(stageBox.x).toBeGreaterThanOrEqual(viewportBox.x);
    expect(stageBox.x + stageBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width);
    expect(connectedBox.y).toBeGreaterThanOrEqual(viewportBox.y);
    expect(connectedBox.y + connectedBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);

    await page.close();
  });

  it("keeps compact overlays and the layout menu keyboard-operable", async () => {
    const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await waitForConnectedWorkspace(page);
    const ipadRow = page.getByRole("button", {
      name: "Edit App Store · iPad connected row",
      exact: true,
    });
    await ipadRow.focus();
    await page.keyboard.press("Enter");
    const ipadOutputRow = page.getByTestId("overview-output-row").filter({ hasText: "App Store · iPad" });
    await expect.poll(() => ipadOutputRow.getAttribute("data-editing")).toBe("true");
    expect(await page.getByTestId("connected-artboards").getByTestId("editor-stage")
      .getAttribute("data-stage-screen-ids")).toBe("unrelated");

    const iphoneRow = page.getByRole("button", {
      name: "Edit App Store · iPhone connected row",
      exact: true,
    });
    await iphoneRow.focus();
    await page.keyboard.press("Space");
    const iphoneOutputRow = page.getByTestId("overview-output-row").filter({ hasText: "App Store · iPhone" });
    await expect.poll(() => iphoneOutputRow.getAttribute("data-editing")).toBe("true");
    expect(await page.getByTestId("connected-artboards").getByTestId("editor-stage")
      .getAttribute("data-stage-screen-ids")).toBe("connected-first connected-second");

    const structure = page.getByRole("button", { name: "Structure panel", exact: true });
    const inspect = page.getByRole("button", { name: "Inspect", exact: true });
    expect(await structure.getAttribute("aria-pressed")).toBe("false");
    expect(await inspect.getAttribute("aria-pressed")).toBe("false");

    const layoutSelector = page.getByRole("button", { name: "Active layout: Default" });
    await layoutSelector.focus();
    await page.keyboard.press("Enter");
    const layoutMenu = page.getByRole("menu", { name: "Design layouts" });
    await layoutMenu.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "More actions for Default" }).click();
    const modeAction = page.getByRole("menu", { name: "Actions for Default" })
      .getByRole("menuitem", { name: /Switch to isolated/ });
    expect(await modeAction.textContent()).toContain(
      "will be clipped while isolated. Layout data remains unchanged.",
    );
    await page.keyboard.press("Escape");
    await expect.poll(() => layoutMenu.count()).toBe(0);
    expect(await layoutSelector.evaluate((node) => document.activeElement === node)).toBe(true);

    await structure.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => structure.getAttribute("aria-pressed")).toBe("true");
    expect(await inspect.getAttribute("aria-pressed")).toBe("false");
    await page.getByRole("list", { name: "Screens for en · iphone" }).waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await expect.poll(() => structure.getAttribute("aria-pressed")).toBe("false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.close();
  });

  it("resets stale export filters after switching layouts", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await waitForConnectedWorkspace(page);

    await page.getByRole("button", { name: "Export", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("button", { name: "Device" }).click();
    await dialog.getByRole("menuitemradio", { name: "ipad", exact: true }).click();
    expect(await dialog.getByRole("button", { name: "Device" }).textContent()).toContain("ipad");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Active layout: Default" }).click();
    await page.getByRole("menuitemradio", { name: /Isolated campaign/ }).click();
    await page.getByRole("button", { name: "Active layout: Isolated campaign" }).waitFor();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Export" });

    expect((await dialog.getByRole("button", { name: "Platform" }).textContent())?.trim()).toBe("all");
    expect((await dialog.getByRole("button", { name: "Device" }).textContent())?.trim()).toBe("all");
    expect((await dialog.getByRole("button", { name: "Locale" }).textContent())?.trim()).toBe("all");
    await page.close();
  });
});
