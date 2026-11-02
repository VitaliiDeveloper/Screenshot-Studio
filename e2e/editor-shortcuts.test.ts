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
    screens: Array<{ id: string; elements: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      name?: string;
      color?: string;
      shadow?: unknown;
    }> }>;
  }> };
  return root.layouts[0]!;
}

const heroLayer = (id: string) => project().screens[0]!.elements.find((element) => element.id === id);

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

describe("keyboard focus never drops to the page behind a selection", () => {
  const focusedLabel = (page: Page) => page.evaluate(() => {
    const active = document.activeElement;
    return active?.getAttribute("aria-label") ?? active?.textContent?.trim() ?? active?.tagName;
  });
  // ArrowDown nudges by 10 px and Backspace deletes the selection whenever focus is on <body>.
  const expectKeysLeave = async (page: Page, id: string) => {
    const before = heroLayer(id);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(800);
    expect(heroLayer(id)).toEqual(before);
  };
  const selectLayer = async (page: Page, name: string) => {
    await page.getByRole("button", { name, exact: true }).click();
  };

  it("moves focus to the replacement control when an optional effect toggles", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    await selectLayer(page, "Hero support");
    await page.getByRole("button", { name: "Add shadow", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => heroLayer("hero-support")?.shadow).toBeTruthy();
    expect(await focusedLabel(page)).toBe("Remove shadow");
    await expectKeysLeave(page, "hero-support");

    // Undo removes the focused button too, without any click on it.
    await page.keyboard.press("Control+z");
    await expect.poll(() => heroLayer("hero-support")?.shadow ?? null).toBeNull();
    expect(await focusedLabel(page)).toBe("Add shadow");
    await expectKeysLeave(page, "hero-support");
  });

  it("returns focus from the layer menu to its trigger, or a live control after a delete", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    await selectLayer(page, "Hero support");
    const openMenu = async (layer: string) => {
      await page.getByRole("button", { name: `More actions for ${layer}`, exact: true }).focus();
      await page.keyboard.press("Enter");
    };

    for (const item of ["Lock layer", "Hide layer"]) {
      await openMenu("Hero headline");
      await page.getByRole("menuitem", { name: item, exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => focusedLabel(page)).toBe("More actions for Hero headline");
      await expectKeysLeave(page, "hero-support");
    }

    await openMenu("Hero headline");
    await page.getByRole("menuitem", { name: "Delete layer", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => heroLayer("headline")).toBeUndefined();
    expect(await focusedLabel(page)).toBe("Add element");
    await expectKeysLeave(page, "hero-support");
  });

  it("keeps focus in the inspector when a multi-selection action replaces its section", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    const hero = page.getByRole("list", { name: "Layers for Hero", exact: true });
    const selectBoth = async () => {
      await hero.getByRole("button", { name: "Hero headline", exact: true }).click();
      await hero.getByRole("button", { name: "Hero support", exact: true }).click({ modifiers: ["Shift"] });
    };

    await selectBoth();
    await page.getByRole("button", { name: "Delete selected", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => heroLayer("headline")).toBeUndefined();
    expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("tab");
    const layers = project().screens[0]!.elements.length;
    await page.keyboard.press("t");
    await page.waitForTimeout(800);
    expect(project().screens[0]!.elements.length).toBe(layers);

    await page.keyboard.press("Control+z");
    await expect.poll(() => heroLayer("headline")).toBeTruthy();
    await selectBoth();
    await page.getByRole("button", { name: /^Group/ }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => heroLayer("headline")).toBeUndefined();
    expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("tab");
    const groupedLayers = project().screens[0]!.elements.length;
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(800);
    expect(project().screens[0]!.elements.length).toBe(groupedLayers);
  });

  it("lands on the active screen row after deleting a screen", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    const saveFastSupport = () => project().screens.find((screen) => screen.id === "save-fast")!
      .elements.find((element) => element.id === "save-fast-support")!;
    await page.getByRole("button", { name: /^Save Fast · /, exact: false }).first().click();
    await page.getByRole("button", { name: "Save fast support", exact: true }).click();
    await expect.poll(() => page.getByTestId("editor-stage").first().getAttribute("data-selection-count")).toBe("1");

    const deleteHero = page.getByRole("button", { name: "Delete Hero", exact: true }).first();
    await deleteHero.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Delete screen?" });
    // Cancelling keeps the live trigger: the fallback only stands in for a removed one.
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await expect.poll(() => focusedLabel(page)).toBe("Delete Hero");
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Delete screen", exact: true }).focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "detached" });

    await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute("data-screen-id"))).toBe(true);
    const before = { ...saveFastSupport() };
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(800);
    expect(saveFastSupport()).toEqual(before);
  });

  it("renames a layer with Enter, cancels with Escape, and returns focus to the row", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    await selectLayer(page, "Hero support");
    const rename = async (typed: string, key: "Enter" | "Escape") => {
      await page.getByRole("button", { name: /^More actions for Hero support/ }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "Rename layer", exact: true }).click();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(typed);
      await page.keyboard.press(key);
    };

    await rename("Cancelled", "Escape");
    const list = page.getByRole("list", { name: "Layers for Hero", exact: true });
    await expect.poll(() => focusedLabel(page)).toBe("More actions for Hero support");
    expect(await list.isVisible()).toBe(true);
    await page.waitForTimeout(800);
    expect(heroLayer("hero-support")?.name).toBe("Hero support");
    await expectKeysLeave(page, "hero-support");

    await rename("Renamed", "Enter");
    await expect.poll(() => heroLayer("hero-support")?.name).toBe("Renamed");
    await expect.poll(() => focusedLabel(page)).toBe("More actions for Renamed");
    await expectKeysLeave(page, "hero-support");
  });
});

describe("undo steps", () => {
  it("keeps a canvas drag or rename apart from typing that follows, and coalesces the typing", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    const before = heroLayer("headline")!.x;

    const stage = page.locator("[data-stage-screen-ids='hero']").first();
    const box = (await stage.boundingBox())!;
    const scale = box.width / 1206;
    const from = { x: box.x + 600 * scale, y: box.y + 250 * scale };
    await page.mouse.click(from.x, from.y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 60 * scale, from.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => heroLayer("headline")!.x).not.toBe(before);
    const dragged = heroLayer("headline")!.x;

    const fieldX = page.getByRole("spinbutton", { name: "X", exact: true });
    await fieldX.click();
    await fieldX.fill("");
    await page.keyboard.type("123");
    await page.keyboard.press("Tab");
    await expect.poll(() => heroLayer("headline")!.x).toBe(123);

    await undo.click();
    await expect.poll(() => heroLayer("headline")!.x).toBe(dragged);

    await undo.click();
    await expect.poll(() => heroLayer("headline")!.x).toBe(before);

    // A canvas toolbar edit stays apart from the inspector field edited next.
    const color = heroLayer("headline")!.color;
    await page.getByLabel("Selection color", { exact: true }).fill("#ff0000");
    await expect.poll(() => heroLayer("headline")!.color).toBe("#ff0000");
    await fieldX.click();
    await fieldX.fill("");
    await page.keyboard.type("45");
    await page.keyboard.press("Tab");
    await expect.poll(() => heroLayer("headline")!.x).toBe(45);
    await undo.click();
    await expect.poll(() => heroLayer("headline")!.x).toBe(before);
    expect(heroLayer("headline")!.color).toBe("#ff0000");
    await undo.click();
    await expect.poll(() => heroLayer("headline")!.color).toBe(color);
  });
});

describe("dialog focus", () => {
  const openCreateLayout = async (page: Page) => {
    await page.getByRole("button", { name: "Active layout: Default", exact: true }).click();
    await page.getByRole("menuitem", { name: /Create layout/ }).click();
    return page.getByRole("dialog", { name: "Create layout" });
  };

  it("honours a body control that took focus and keeps Space away from the Close button", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    const dialog = await openCreateLayout(page);
    await dialog.waitFor({ state: "visible" });
    await page.waitForTimeout(100);
    await page.keyboard.type("My layout");
    expect(await dialog.getByRole("textbox", { name: "Name" }).inputValue()).toBe("My layout");
    await dialog.waitFor({ state: "visible" });
  });

  it("starts in the body rather than on the header Close button", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    await page.keyboard.press("Control+e");
    const exportDialog = page.getByRole("dialog", { name: "Export" });
    await exportDialog.waitFor({ state: "visible" });
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[role='dialog'] header") === null
      && document.activeElement?.closest("[role='dialog']") !== null)).toBe(true);
  });

  it("brings Tab and Shift+Tab back when focus has left the modal", async () => {
    const page = await openEditor({ width: 1440, height: 1000 });
    const dialog = await openCreateLayout(page);
    await dialog.waitFor({ state: "visible" });
    const focusBehindDialog = () => page.getByRole("button", { name: "Find screen or layer", exact: true }).focus();
    const inDialog = () => page.evaluate(() => document.activeElement?.closest("[role='dialog']") !== null);

    await focusBehindDialog();
    expect(await inDialog()).toBe(false);
    await page.keyboard.press("Tab");
    expect(await inDialog()).toBe(true);

    await focusBehindDialog();
    await page.keyboard.press("Shift+Tab");
    expect(await inDialog()).toBe(true);
  });
});
