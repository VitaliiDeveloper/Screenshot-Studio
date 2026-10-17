// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

/**
 * Slice 4 gate: reordering a layer in the panel persists the new `elements` array order (= z-order)
 * to the on-disk JSON. Reorder is driven via dnd-kit's KeyboardSensor for determinism (no pixel
 * drag). The locator is scoped to the Layers section — the fixture has one screen (not reorderable)
 * but two layers. Runs against a temp copy so the committed fixture is untouched.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/sample/assets");

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
  server = await startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") });
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
  return p.layouts[0].screens[0].elements.map((e: { id: string }) => e.id);
}

function screenIds(): string[] {
  const project = JSON.parse(readFileSync(projectFile, "utf8"));
  return project.layouts[0].screens.map((screen: { id: string }) => screen.id);
}

function elementName(id: string): string | undefined {
  const project = JSON.parse(readFileSync(projectFile, "utf8"));
  return project.layouts[0].screens[0].elements.find((element: { id: string }) => element.id === id)?.name;
}

describe("left panel", () => {
  it("reordering a layer persists the new element order to disk", async () => {
    const before = elementIds(); // ["accent", "headline"]
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    // Scope to the active screen's nested layers list, then focus the top layer row's drag handle
    // and move it down one slot with the keyboard.
    const layers = page.getByRole("list", { name: "Layers for Hero" });
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

  it("supports keyboard layer actions, Escape close, and menu-based rename", async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const trigger = page.getByRole("button", { name: "More actions for Hero headline", exact: true });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Hero headline actions", exact: true });
    await menu.waitFor({ state: "visible" });
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("Rename");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent?.trim())).toBe("Hide");
    await page.keyboard.press("Escape");
    expect(await menu.count()).toBe(0);
    expect(await page.getByRole("heading", { name: "Layers", exact: true }).count()).toBe(1);
    expect(await trigger.evaluate((node) => document.activeElement === node)).toBe(true);

    await trigger.click();
    await page.getByRole("menuitem", { name: "Rename layer", exact: true }).click();
    const rename = page.getByRole("list", { name: "Layers for Hero" }).getByRole("textbox");
    await rename.fill("Hero title");
    await rename.press("Enter");
    await expect.poll(() => elementName("headline"), { timeout: 10_000 }).toBe("Hero title");
    await page.close();
  });

  it("expands the layers of a screen activated from the canvas", async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "networkidle" });
    await page.getByRole("list", { name: "Layers for Hero", exact: true }).waitFor();
    await page.getByRole("button", { name: "Hide layers of Hero", exact: true }).click();
    await expect.poll(() => page.getByRole("list", { name: "Layers for Hero", exact: true }).count()).toBe(0);

    await page.getByRole("button", { name: "Edit Save Fast", exact: true }).first().click();
    await page.getByRole("list", { name: "Layers for Save Fast", exact: true }).waitFor({ timeout: 5_000 });
    await page.close();
  });

  it("reorders and deletes screens through the Structure panel", async () => {
    const before = screenIds();
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const screens = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Screens", exact: true }),
    });
    const handle = screens.getByLabel("Drag to reorder").first();
    await handle.focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    await page.keyboard.press("Space");
    await expect.poll(() => screenIds().join(","), { timeout: 10_000 }).not.toBe(before.join(","));

    await page.getByRole("button", { name: "Delete Save Fast", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Delete screen?", exact: true });
    await confirmation.getByRole("button", { name: "Delete screen", exact: true }).click();
    await expect.poll(() => screenIds().length, { timeout: 10_000 }).toBe(before.length - 1);
    expect(screenIds()).not.toContain("save-fast");
    await page.close();
  });
});
