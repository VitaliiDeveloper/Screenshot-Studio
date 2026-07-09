import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

/**
 * Slice 4 gate: reordering a layer in the panel persists the new `elements` array order (= z-order)
 * to the on-disk JSON. Reorder is driven via dnd-kit's KeyboardSensor for determinism (no pixel
 * drag). The locator is scoped to the Layers section — the fixture has one screen (not reorderable)
 * but two layers. Runs against a temp copy so the committed fixture is untouched.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/phase-0-sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/phase-0-sample/assets");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "left-panel-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeFileSync(projectFile, readFileSync(sample, "utf8"));
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  process.env.PROJECT_PATH = projectFile;
  server = await startWebServer(3125);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function elementIds(): string[] {
  const p = JSON.parse(readFileSync(projectFile, "utf8"));
  return p.screens[0].elements.map((e: { id: string }) => e.id);
}

describe("left panel", () => {
  it("reordering a layer persists the new element order to disk", async () => {
    const before = elementIds(); // ["accent", "headline"]
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    // Scope to the Layers section (the single screen is not reorderable), then focus the top
    // layer row's drag handle and move it down one slot with the keyboard.
    const layers = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Layers" }),
    });
    const handle = layers.getByLabel("Drag to reorder").first();
    await handle.waitFor();
    await handle.focus();
    // Small gaps between keys: dnd-kit's KeyboardSensor updates drag state async, so the pick-up
    // must register before the move, and the move before the drop.
    await page.keyboard.press("Space");      // pick up
    await page.waitForTimeout(200);
    await page.keyboard.press("ArrowDown");  // move one position
    await page.waitForTimeout(200);
    await page.keyboard.press("Space");      // drop
    await expect.poll(() => elementIds().join(","), { timeout: 10_000 })
      .not.toBe(before.join(","));
    expect(elementIds().slice().sort()).toEqual(before.slice().sort()); // same set, new order
    await page.close();
  });
});
