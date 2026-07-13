// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/phase-6-connected/app-store-screenshots.json");

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "connected-workspace-"));
  projectPath = join(directory, "app-store-screenshots.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    platforms: string[];
    screens: Array<{
      id: string;
      platform: string;
      device: string;
    }>;
  };
  const ipad = fixture.screens.find((screen) => screen.id === "unrelated")!;
  ipad.platform = "apple";
  ipad.device = "ipad";
  fixture.platforms = ["apple"];
  writeFileSync(projectPath, `${JSON.stringify(fixture, null, 2)}\n`);
  process.env.PROJECT_PATH = projectPath;
  server = await startWebServer();
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function project() {
  return JSON.parse(readFileSync(projectPath, "utf8"));
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

describe("Phase 6 connected workspace hardening", () => {
  it("keeps group scope, owner surfaces, thumbnails, history, snapping, and mode guard coherent", async () => {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const connected = page.getByTestId("connected-artboards");
    await connected.waitFor({ state: "visible" });
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
    const outputScope = page.getByRole("button", {
      name: "Open Store Outputs for en iphone",
      exact: true,
    });
    expect(await outputScope.textContent()).toBe("en · iphone");

    const jsonBeforeNavigation = readFileSync(projectPath, "utf8");
    const iphonePixelsBefore = await iphoneRow.locator("canvas").first()
      .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
    await ipadRowButton.click();
    const ipadRow = rows.filter({ hasText: "App Store · iPad" });
    await expect.poll(() => ipadRow.getAttribute("data-editing")).toBe("true");
    await page.getByRole("list", { name: "Screens for en · ipad" }).waitFor({ state: "visible" });
    await expect.poll(() => page.getByTestId("layers-owner").textContent()).toBe("Unrelated");
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

    const mode = page.getByRole("button", { name: "Canvas mode: connected" });
    expect(await page.getByRole("button", { name: "Undo" }).isDisabled()).toBe(true);
    await mode.click();
    const modeError = page.getByRole("alert").filter({ hasText: "Can't switch to isolated canvas yet" });
    await expect.poll(() => modeError.textContent(), { timeout: 5_000 }).toContain("screen boundaries");
    expect(project().mode).toBe("connected");
    expect(await page.getByRole("button", { name: "Undo" }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Dismiss canvas mode error" }).click();

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
    await mode.click();
    await expect.poll(() => project().mode).toBe("isolated");
    const isolatedMode = page.getByRole("button", { name: "Canvas mode: isolated" });
    await expect.poll(() => isolatedMode.count()).toBe(1);
    await expect.poll(() => page.getByTestId("connected-artboards").count()).toBe(0);

    await isolatedMode.click();
    const connectedModeDialog = page.getByRole("dialog", { name: "Switch to connected canvas?" });
    await connectedModeDialog.waitFor({ state: "visible" });
    expect(project().mode).toBe("isolated");
    await connectedModeDialog.getByRole("button", { name: "Switch to connected", exact: true }).click();
    await expect.poll(() => project().mode).toBe("connected");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => project().mode).toBe("isolated");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => project().mode).toBe("connected");
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(bridgeX).toBe(560);

    await secondButton.click();
    await expect.poll(() => secondButton.getAttribute("aria-current")).toBe("true");
    await expect.poll(() => stage.getAttribute("data-active-screen-id")).toBe("connected-second");
    await expect.poll(() => page.getByTestId("layers-owner").textContent()).toBe("Connected Second");
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

  it("keeps compact overlays and mode feedback keyboard-operable", async () => {
    const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });
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

    const mode = page.getByRole("button", { name: "Canvas mode: connected" });
    await mode.focus();
    await page.keyboard.press("Enter");
    const modeError = page.getByRole("alert").filter({ hasText: "Can't switch to isolated canvas yet" });
    await modeError.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await expect.poll(() => modeError.count()).toBe(0);
    expect(await mode.evaluate((node) => document.activeElement === node)).toBe(true);

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
});
