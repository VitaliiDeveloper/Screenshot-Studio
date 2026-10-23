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

const CONNECTED_STAGE_WIDTH = 1320;
const BRIDGE_DRAG_POINT = { x: 650, y: 300 };

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "editor-snapping-"));
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, readFileSync(fixturePath));
  process.env.PROJECT_PATH = projectPath;
  server = await startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function bridgeX(): number {
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  return project.layouts[0].screens[0].elements.find((element: { id: string }) => element.id === "bridge").x;
}

async function beginBridgeDrag(page: Page, logicalDeltaX: number) {
  const connected = page.getByTestId("connected-artboards");
  const canvas = connected.locator("canvas").first();
  const viewport = page.getByTestId("canvas-viewport");
  await canvas.waitFor({ state: "visible" });
  await viewport.evaluate((node, { deltaX, point, stageWidth }) => {
    const canvasNode = node.querySelector<HTMLCanvasElement>('[data-testid="connected-artboards"] canvas');
    if (!canvasNode) throw new Error("Connected canvas is unavailable");
    const viewportBox = node.getBoundingClientRect();
    const canvasBox = canvasNode.getBoundingClientRect();
    const scale = canvasBox.width / stageWidth;
    const dragCenterX = canvasBox.left + (point.x + deltaX / 2) * scale;
    const dragY = canvasBox.top + point.y * scale;
    node.scrollLeft += dragCenterX - (viewportBox.left + viewportBox.width / 2);
    node.scrollTop += dragY - (viewportBox.top + viewportBox.height / 2);
  }, { deltaX: logicalDeltaX, point: BRIDGE_DRAG_POINT, stageWidth: CONNECTED_STAGE_WIDTH });

  await expect.poll(async () => {
    const [box, viewportBox] = await Promise.all([canvas.boundingBox(), viewport.boundingBox()]);
    if (!box || !viewportBox) return false;
    const scale = box.width / CONNECTED_STAGE_WIDTH;
    const startX = box.x + BRIDGE_DRAG_POINT.x * scale;
    const endX = startX + logicalDeltaX * scale;
    const y = box.y + BRIDGE_DRAG_POINT.y * scale;
    return [startX, endX].every((x) => x >= viewportBox.x && x <= viewportBox.x + viewportBox.width)
      && y >= viewportBox.y
      && y <= viewportBox.y + viewportBox.height;
  }).toBe(true);

  const box = (await canvas.boundingBox())!;
  const scale = box.width / CONNECTED_STAGE_WIDTH;
  const x = box.x + BRIDGE_DRAG_POINT.x * scale;
  const y = box.y + BRIDGE_DRAG_POINT.y * scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + logicalDeltaX * scale, y, { steps: 8 });
  return { connected, scale };
}

describe("editor snapping", () => {
  it("uses a zoom-correct threshold and ephemeral connected-space guide", async () => {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const connected = page.getByTestId("connected-artboards");
    await connected.waitFor({ state: "visible" });

    const structureToggle = page.getByRole("button", { name: "Layers panel", exact: true });
    if ((await structureToggle.getAttribute("aria-pressed")) !== "true") await structureToggle.click();
    const stage = connected.getByTestId("editor-stage");
    await page.getByRole("list", { name: "Layers for Connected First" })
      .getByRole("button", { name: "Shape", exact: true })
      .click();
    await expect.poll(() => stage.getAttribute("data-selection-count")).toBe("1");
    // The W × H badge reports the layer box in artboard px, whatever the zoom.
    const sizeBadge = stage.getByTestId("selection-size");
    await expect.poll(() => sizeBadge.textContent()).toBe("200 × 300");

    const zoomControls = page.getByLabel("Zoom controls");
    const zoomValue = zoomControls.getByRole("button").nth(1);
    await zoomValue.click();
    await expect.poll(() => zoomValue.textContent()).toBe("100%");

    let drag = await beginBridgeDrag(page, -108);
    expect(await stage.getAttribute("data-snap-guide-x")).toBeNull();
    expect(await sizeBadge.count()).toBe(0);
    await page.mouse.up();
    await expect.poll(bridgeX).toBeCloseTo(452, 0);
    await expect.poll(() => sizeBadge.count()).toBe(1);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(bridgeX).toBe(560);

    // Handoff § 6: arrows nudge the selection 10 px, 50 px with Shift.
    // Selecting on the canvas right after a toolbar button must hand the keys back to the canvas.
    const bridgeCanvas = page.getByTestId("connected-artboards").locator("canvas").first();
    const bridgeBox = (await bridgeCanvas.boundingBox())!;
    const bridgeScale = bridgeBox.width / CONNECTED_STAGE_WIDTH;
    await page.mouse.click(bridgeBox.x + 660 * bridgeScale, bridgeBox.y + 300 * bridgeScale);
    await expect.poll(() => stage.getAttribute("data-selection-count")).toBe("1");
    await page.keyboard.press("ArrowRight");
    await expect.poll(bridgeX).toBe(570);
    await page.keyboard.press("Shift+ArrowLeft");
    await expect.poll(bridgeX).toBe(520);
    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(bridgeX).toBe(560);

    const zoomOut = zoomControls.getByRole("button", { name: "Zoom out" });
    for (const value of ["90%", "80%", "70%", "60%", "50%"]) {
      await zoomOut.click();
      await expect.poll(() => zoomValue.textContent()).toBe(value);
    }

    drag = await beginBridgeDrag(page, -108);
    await expect.poll(() => (
      drag.connected.getByTestId("editor-stage").getAttribute("data-snap-guide-x")
    )).toBe("660");
    await page.mouse.up();
    await expect.poll(bridgeX).toBe(460);
    expect(await stage.getAttribute("data-snap-guide-x")).toBeNull();

    // On the second connected screen the badge sits under that screen's layer, not the first's.
    await page.getByRole("button", { name: "Connected Second · iPhone" }).click();
    await page.getByRole("list", { name: "Layers for Connected Second" })
      .getByRole("button", { name: "Shape", exact: true })
      .click();
    await expect.poll(() => sizeBadge.textContent()).toBe("200 × 200");
    const stageBox = (await stage.locator("canvas").first().boundingBox())!;
    const stageScale = stageBox.width / CONNECTED_STAGE_WIDTH;
    const badgeBox = (await sizeBadge.boundingBox())!;
    expect(Math.abs(badgeBox.x + badgeBox.width / 2 - (stageBox.x + (660 + 160 + 100) * stageScale))).toBeLessThan(2);
    expect(badgeBox.y).toBeGreaterThan(stageBox.y + 900 * stageScale);

    await page.reload({ waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });
    expect(await page.getByTestId("connected-artboards").getByTestId("editor-stage")
      .getAttribute("data-snap-guide-x")).toBeNull();

    await page.close();
  });
});
