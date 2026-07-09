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
  writeFileSync(projectFile, readFileSync(sample, "utf8"));
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

interface Geom { id: string; x: number; y: number; width: number; height: number }

function headline(): Geom {
  const p = JSON.parse(readFileSync(projectFile, "utf8"));
  return p.screens[0].elements.find((e: Geom) => e.id === "headline");
}

describe("editor round-trip", () => {
  it("dragging an element persists its new position to disk", async () => {
    const start = headline();
    // Viewport must fit the 660×1434 artboard between the two 256px side panels (LeftPanel +
    // Inspector, slice 5) at zoom=1, else the element sits under a panel / below the fold and the
    // mouse can't hit it.
    const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
    // Match the project's proven readiness pattern (render-driver.ts): "load", not "networkidle"
    // — next dev's HMR channel keeps the network busy and makes "networkidle" flaky.
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const canvas = await page.waitForSelector("canvas");
    const box = (await canvas.boundingBox())!;

    // Coords are computed, not guessed: the stage is 1:1, so the headline's centre on screen is
    // the canvas origin plus its document x/y/width/height.
    const cx = box.x + start.x + start.width / 2;
    const cy = box.y + start.y + start.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy + 30, { steps: 5 });
    await page.mouse.up();

    // Wait for the PUT to land, then assert the on-disk x changed.
    await expect.poll(() => headline().x, { timeout: 10_000 }).not.toBe(start.x);
    await page.close();
  });
});
