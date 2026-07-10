import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

/**
 * Slice 1 behavioral gate: the interactive editor mutates an element and the change round-trips
 * through the store and the API route to the on-disk JSON. Runs against a temp copy so the
 * committed fixture is never modified. PROJECT_PATH points the /api/project route at that copy.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/phase-0-sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/phase-0-sample/assets");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "editor-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  const fixture = JSON.parse(readFileSync(sample, "utf8"));
  fixture.screens[0].elements.push({
    id: "contain-shot",
    type: "screenshot",
    x: 10,
    y: 1180,
    width: 200,
    height: 100,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    name: "Contain preview",
    assetUrl: "assets/demo-logistics-app.png",
    fit: "contain",
    cornerRadius: 12,
  });
  writeFileSync(projectFile, JSON.stringify(fixture));
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  process.env.PROJECT_PATH = projectFile;
  server = await startWebServer(3124);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

interface Geom {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked?: boolean;
  content?: string;
}

function element(id: string): Geom {
  const p = JSON.parse(readFileSync(projectFile, "utf8"));
  return p.screens[0].elements.find((e: Geom) => e.id === id);
}

const headline = () => element("headline");

describe("editor round-trip", () => {
  it("dragging an element persists its new position to disk", async () => {
    const start = headline();
    // The Phase 3.6 viewport fits the active artboard automatically between the contextual shelf
    // and inspector, so derive the live stage scale instead of assuming a 1:1 canvas.
    const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
    // Match the project's proven readiness pattern (render-driver.ts): "load", not "networkidle"
    // — next dev's HMR channel keeps the network busy and makes "networkidle" flaky.
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const canvas = await page.waitForSelector("canvas");
    const box = (await canvas.boundingBox())!;

    // Coords are computed, not guessed: Konva receives document coordinates while the canvas is
    // visually scaled by the workspace viewport.
    const scale = box.width / 660;
    const cx = box.x + (start.x + start.width / 2) * scale;
    const cy = box.y + (start.y + start.height / 2) * scale;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // Keep the headline in its original vertical band so later text-edit checks are not covered
    // by the separate support layer.
    await page.mouse.move(cx + 40, cy, { steps: 5 });
    await page.mouse.up();

    // Wait for the PUT to land, then assert the on-disk x changed.
    await expect.poll(() => headline().x, { timeout: 10_000 }).not.toBe(start.x);
    await page.close();
  });

  it("selects a device frame when its rendered child is clicked on canvas", async () => {
    const deviceFrame = element("hero-device");
    const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });

    const canvases = page.getByTestId("overview-artboards").locator("canvas");
    await expect.poll(() => canvases.count()).toBe(3);
    const canvas = canvases.first();
    const box = (await canvas.boundingBox())!;
    const scale = box.width / 660;

    await page.mouse.click(
      box.x + (deviceFrame.x + deviceFrame.width / 2) * scale,
      box.y + (deviceFrame.y + deviceFrame.height / 2) * scale,
    );

    const inspector = page.locator("aside").filter({
      has: page.getByRole("heading", { name: "Inspect", exact: true }),
    });
    await expect.poll(() => inspector.getByRole("heading", { name: "Device frame", exact: true }).count()).toBe(1);
    await page.close();
  });

  it("positions inline text editing over the selected text and supports cancel/commit", async () => {
    const start = headline();
    const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const canvas = page.getByTestId("overview-artboards").locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    const scale = box.width / 660;
    const x = box.x + (start.x + start.width / 2) * scale;
    const y = box.y + (start.y + start.height / 2) * scale;

    await page.mouse.dblclick(x, y);
    const editor = page.getByLabel("Edit Hero headline", { exact: true });
    await editor.waitFor({ state: "visible" });
    const editBox = (await editor.boundingBox())!;
    expect(Math.abs(editBox.x - (box.x + start.x * scale))).toBeLessThan(2);
    expect(Math.abs(editBox.y - (box.y + start.y * scale))).toBeLessThan(2);
    expect(Math.abs(editBox.width - start.width * scale)).toBeLessThan(2);

    await editor.fill("Cancelled copy");
    await editor.press("Escape");
    await editor.waitFor({ state: "detached" });
    await page.waitForTimeout(50); // allow Konva's scene + hit canvases to redraw the restored text
    expect(headline().content).toBe(start.content);

    const secondBox = (await canvas.boundingBox())!;
    const secondScale = secondBox.width / 660;
    await page.mouse.dblclick(
      secondBox.x + (start.x + start.width / 2) * secondScale,
      secondBox.y + (start.y + start.height / 2) * secondScale,
    );
    const reopened = page.getByLabel("Edit Hero headline", { exact: true });
    await reopened.fill("Ship it now");
    await reopened.press("Control+Enter");
    await expect.poll(() => headline().content, { timeout: 10_000 }).toBe("Ship it now");
    await page.close();
  });

  it("keeps locked layers selectable but blocks canvas transform and text editing", async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const layer = page.getByRole("button", { name: "Hero headline", exact: true });
    await layer.click();
    await page.getByRole("button", { name: "More actions for Hero headline", exact: true }).click();
    await page.getByRole("menuitem", { name: "Lock layer", exact: true }).click();
    await expect.poll(() => headline().locked).toBe(true);

    const start = headline();
    const canvas = page.getByTestId("overview-artboards").locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    const scale = box.width / 660;
    const centerX = box.x + (start.x + start.width / 2) * scale;
    const centerY = box.y + (start.y + start.height / 2) * scale;
    await page.mouse.dblclick(centerX, centerY);
    expect(await page.getByLabel("Edit Hero headline", { exact: true }).count()).toBe(0);

    const handleX = box.x + (start.x + start.width) * scale;
    const handleY = box.y + (start.y + start.height) * scale;
    await page.mouse.move(handleX, handleY);
    await page.mouse.down();
    await page.mouse.move(handleX + 30, handleY + 20, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(headline()).toMatchObject({
      x: start.x,
      y: start.y,
      width: start.width,
      height: start.height,
    });

    await page.getByRole("button", { name: "More actions for Hero headline", exact: true }).click();
    await page.getByRole("menuitem", { name: "Unlock layer", exact: true }).click();
    await expect.poll(() => headline().locked).toBe(false);
    await page.close();
  });

  it("drags contain-mode screenshots by their logical box without changing its size", async () => {
    const start = element("contain-shot");
    const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const canvas = page.getByTestId("overview-artboards").locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    const scale = box.width / 660;
    // The source is portrait inside a wide box; x+10 lands in the transparent letterbox area.
    const x = box.x + (start.x + 10) * scale;
    const y = box.y + (start.y + start.height / 2) * scale;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 20 * scale, y + 15 * scale, { steps: 5 });
    await page.mouse.up();

    await expect.poll(() => Math.abs(element("contain-shot").x - (start.x + 20)), { timeout: 10_000 }).toBeLessThan(1.5);
    expect(element("contain-shot")).toMatchObject({ width: start.width, height: start.height });
    expect(Math.abs(element("contain-shot").y - (start.y + 15))).toBeLessThan(1.5);
    await page.close();
  });
});
