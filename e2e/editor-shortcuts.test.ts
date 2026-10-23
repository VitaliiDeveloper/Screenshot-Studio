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

let server: RunningServer;
let browser: Browser;
let page: Page | undefined;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "shortcuts-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  cpSync(resolve(repoRoot, "fixtures/sample/assets"), join(dir, "assets"), { recursive: true });
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

// The shipped sample has iPhone and iPad rows, so `]` has a next size to reach.
beforeEach(() => writeFileSync(projectFile, readFileSync(sample, "utf8")));

afterEach(async () => {
  await page?.close();
  page = undefined;
});

function project() {
  const root = JSON.parse(readFileSync(projectFile, "utf8")) as { layouts: Array<{
    screens: Array<{ elements: Array<{ id: string; x: number; y: number }> }>;
  }> };
  return root.layouts[0]!;
}

async function openEditor(viewport: { width: number; height: number }): Promise<Page> {
  page = await browser.newPage({ viewport });
  await page.goto(`${server.url}/editor`, { waitUntil: "load" });
  await page.waitForSelector("canvas");
  return page;
}

const blurToBody = (page: Page) => page.evaluate(() => {
  document.body.tabIndex = -1;
  document.body.focus();
});

describe("status bar and keyboard shortcuts", () => {
  it("finds screens and layers with Ctrl+K and steps sizes, views, and Export from the keyboard", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    const statusBar = page.getByTestId("status-bar");
    const trigger = page.getByRole("button", { name: "Find screen or layer", exact: true });
    const search = page.getByRole("combobox", { name: "Find screen or layer", exact: true });
    const focusedIs = (locator: typeof trigger) => locator.evaluate((node) => node === document.activeElement);
    await page.evaluate(() => {
      const prevented: Array<[string, boolean]> = [];
      (window as unknown as { prevented: typeof prevented }).prevented = prevented;
      // Read after dispatch ends: the app may re-register its listener behind this one.
      window.addEventListener("keydown", (event) => {
        if (event.ctrlKey) setTimeout(() => prevented.push([event.key, event.defaultPrevented]));
      });
    });

    expect((await statusBar.boundingBox())!.height).toBeCloseTo(34, 0);
    await statusBar.getByText("No unsaved changes").waitFor();
    await statusBar.getByText("Hero · No layer selected · iPhone Dynamic Island · Medium").waitFor();
    const heroLayers = project().screens[0]!.elements.length;

    // Typing in the field never triggers a canvas shortcut (t adds text, o toggles the view).
    await blurToBody(page);
    await page.keyboard.press("Control+k");
    await search.waitFor({ state: "visible" });
    expect(await focusedIs(search)).toBe(true);
    await page.keyboard.type("hero support");
    const options = page.getByRole("option");
    await expect.poll(() => options.count()).toBe(1);
    expect(await page.getByRole("button", { name: "Overview", exact: true }).getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Enter");
    await search.waitFor({ state: "detached" });
    await statusBar.getByText("Hero · Hero support · ").waitFor();
    await expect.poll(() => focusedIs(trigger)).toBe(true);
    expect(project().screens[0]!.elements.length).toBe(heroLayers);

    // From the trigger the same chord reopens it; arrows move the active option; Esc closes it.
    await page.keyboard.press("Control+k");
    await search.waitFor({ state: "visible" });
    await page.keyboard.type("headline");
    await expect.poll(() => options.count()).toBe(3);
    await page.keyboard.press("ArrowDown");
    expect(await options.nth(1).getAttribute("aria-selected")).toBe("true");
    expect(await search.getAttribute("aria-activedescendant")).toBe(await options.nth(1).getAttribute("id"));
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    expect(await options.nth(2).getAttribute("aria-selected")).toBe("true");
    await page.keyboard.press("Escape");
    await search.waitFor({ state: "detached" });
    await expect.poll(() => focusedIs(trigger)).toBe(true);
    const layersToggle = page.getByRole("button", { name: "Layers panel", exact: true });
    expect(await layersToggle.getAttribute("aria-pressed")).toBe("true");
    await statusBar.getByText("Hero · Hero support · ").waitFor();

    // With the Layers panel closed, the chord opens the panel and the search together.
    await layersToggle.click();
    await expect.poll(() => layersToggle.getAttribute("aria-pressed")).toBe("false");
    await blurToBody(page);
    await page.keyboard.press("Control+k");
    await search.waitFor({ state: "visible" });
    await expect.poll(() => focusedIs(search)).toBe(true);
    expect(await layersToggle.getAttribute("aria-pressed")).toBe("true");

    // A pick can move to another screen of the same size.
    await page.keyboard.type("save fast headline");
    await page.keyboard.press("Enter");
    await statusBar.getByText("Save Fast · Save fast headline · ").waitFor();

    // Saving shows the time of the last successful save.
    const saveFastLayers = project().screens[1]!.elements.length;
    await blurToBody(page);
    await page.keyboard.press("t");
    await expect.poll(() => project().screens[1]!.elements.length, { timeout: 10_000 }).toBe(saveFastLayers + 1);
    await statusBar.locator("time").waitFor();
    await statusBar.getByText("Saved ·", { exact: true }).waitFor();

    // [ and ] walk the Overview sizes; the Screens list follows. A click on a layer row leaves
    // focus on its button, which must not stop the keys.
    const iphoneList = page.getByRole("list", { name: "Screens for en · iPhone", exact: true });
    const ipadList = page.getByRole("list", { name: "Screens for en · iPad", exact: true });
    await iphoneList.waitFor({ state: "visible" });
    const layerRow = page.getByRole("button", { name: "Save fast support", exact: true });
    await layerRow.click();
    expect(await focusedIs(layerRow)).toBe(true);
    await page.keyboard.press("]");
    await ipadList.waitFor({ state: "visible" });
    await page.keyboard.press("[");
    await iphoneList.waitFor({ state: "visible" });

    // A screen collapsed before the keys moved away opens again when they return to it.
    const hideActive = iphoneList.getByRole("button", { name: /^Hide layers of / });
    const activeName = (await hideActive.getAttribute("aria-label"))!.replace("Hide layers of ", "");
    await hideActive.click();
    await iphoneList.getByRole("button", { name: `Show layers of ${activeName}`, exact: true }).waitFor();
    await page.keyboard.press("]");
    await ipadList.waitFor({ state: "visible" });
    await page.keyboard.press("[");
    await iphoneList.getByRole("button", { name: `Hide layers of ${activeName}`, exact: true }).waitFor();

    // O toggles Focus and Overview.
    const focus = page.getByRole("button", { name: "Focus", exact: true });
    await page.keyboard.press("o");
    await expect.poll(() => focus.getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("o");
    await expect.poll(() => focus.getAttribute("aria-pressed")).toBe("false");

    // Ctrl+E opens Export, also from a focused layer row; nothing but Esc reaches the page behind it.
    const heroRow = page.getByRole("button", { name: "Hero support", exact: true });
    await heroRow.click();
    expect(await focusedIs(heroRow)).toBe(true);
    await page.keyboard.press("Control+e");
    const exportDialog = page.getByRole("dialog", { name: "Export" });
    await exportDialog.waitFor({ state: "visible" });
    await page.keyboard.press("o");
    expect(await focus.getAttribute("aria-pressed")).toBe("false");
    await page.keyboard.press("Escape");
    await exportDialog.waitFor({ state: "detached" });

    // Chords work from a focused button too: undo the text added above.
    expect(await focusedIs(heroRow)).toBe(true);
    await page.keyboard.press("Control+z");
    await expect.poll(() => project().screens[1]!.elements.length, { timeout: 10_000 }).toBe(saveFastLayers);

    // Chrome would focus the address bar for Ctrl+K and Ctrl+E unless the app takes them.
    const prevented = await page.evaluate(() => (window as unknown as { prevented: Array<[string, boolean]> }).prevented);
    expect(prevented.filter(([key]) => key === "k" || key === "e"))
      .toEqual([["k", true], ["k", true], ["k", true], ["e", true]]);
  });

  it("keeps the last successful save visible when a save fails", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    const statusBar = page.getByTestId("status-bar");
    await blurToBody(page);

    await page.keyboard.press("t");
    await statusBar.locator("time").waitFor();
    const savedAt = await statusBar.locator("time").innerText();

    await page.route("**/api/project", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "disk unavailable" }) });
    });
    await page.keyboard.press("t");
    await statusBar.getByText("Save failed · last saved").waitFor();
    expect(await statusBar.locator("time").innerText()).toBe(savedAt);
    await page.getByRole("alert").filter({ hasText: "Save failed: disk unavailable" }).waitFor();
  });

  it("leaves the canvas selection alone while a layer's drag handle has focus", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    const headline = () => project().screens[0]!.elements.find((element) => element.id === "headline")!;
    const before = { ...headline() };
    const layers = project().screens[0]!.elements.length;

    await page.getByRole("button", { name: "Hero headline", exact: true }).click();
    const handle = page.getByRole("list", { name: "Layers for Hero", exact: true }).getByRole("listitem")
      .filter({ hasText: "Hero headline" }).getByRole("button", { name: "Drag to reorder" });
    await handle.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Delete");
    await page.waitForTimeout(800);

    expect(headline()).toEqual(before);
    expect(project().screens[0]!.elements.length).toBe(layers);
  });

  it("opens Export from the export intent", async () => {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${server.url}/editor?intent=export`, { waitUntil: "load" });
    await page.getByRole("dialog", { name: "Export" }).waitFor({ state: "visible" });
  });
});
