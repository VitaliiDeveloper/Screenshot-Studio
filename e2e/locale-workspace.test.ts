// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/sample/assets");

interface PersistedElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  content?: string;
  align?: string;
}

interface PersistedScreen {
  id: string;
  name: string;
  platform: string;
  device: string;
  locale: string;
  direction: "ltr" | "rtl";
  storeTargetId?: string;
  artboard: { width: number; height: number };
  elements: PersistedElement[];
}

interface PersistedProject {
  layouts: Array<{ screens: PersistedScreen[] }>;
}

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "locale-workspace-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeFileSync(projectFile, readFileSync(sample, "utf8"));
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

function project(): PersistedProject {
  return JSON.parse(readFileSync(projectFile, "utf8")) as PersistedProject;
}

function localeScreens(locale: string): PersistedScreen[] {
  return project().layouts[0].screens.filter((screen) => screen.locale === locale);
}

function locales(): string[] {
  return [...new Set(project().layouts[0]!.screens.map((screen) => screen.locale))];
}

function localeScreenIds(locale: string): string[] {
  return localeScreens(locale).map((screen) => screen.id);
}

function outputScreenIds(screens: PersistedScreen[], anchor: PersistedScreen): string[] {
  return screens.filter((screen) =>
    screen.platform === anchor.platform
    && screen.device === anchor.device
    && screen.storeTargetId === anchor.storeTargetId,
  ).map((screen) => screen.id);
}

function roundedElementX(screens: PersistedScreen[]): PersistedScreen[] {
  return screens.map((screen) => ({
    ...screen,
    elements: screen.elements.map((element) => ({
      ...element,
      x: Number(element.x.toFixed(9)),
    })),
  }));
}

async function renderedIds(locator: ReturnType<import("playwright").Page["locator"]>): Promise<string> {
  return locator.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-screen-id")).join(","));
}

async function selectLocale(page: import("playwright").Page, locale: string): Promise<void> {
  await page.getByRole("button", { name: /^Active locale:/ }).click();
  await page.getByRole("menu", { name: "Project locales" })
    .getByRole("menuitemradio", { name: locale, exact: true })
    .click();
}

describe("Phase 4 locale workspace", () => {
  it("creates, edits, reorders, and removes complete locale sets", async () => {
    const source = project();
    const sourceScreens = source.layouts[0].screens.filter((screen) => screen.locale === "en");
    const sourceScreenIds = sourceScreens.map((screen) => screen.id);
    const sourceOutputScreenIds = outputScreenIds(sourceScreens, sourceScreens[0]!);
    const sourceElementIds = new Set(sourceScreens.flatMap((screen) => screen.elements.map((element) => element.id)));
    const sourceFirstElement = sourceScreens[0]!.elements[0]!;

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    await page.getByRole("button", { name: "Manage locales" }).click();
    const manager = page.getByRole("dialog", { name: "Locale manager" });
    await manager.getByLabel("Target locale").fill("ar");
    await manager.getByLabel("Copy from locale").selectOption("en");
    await manager.getByLabel("Layout direction").selectOption("rtl");
    await manager.getByRole("button", { name: "Create locale" }).click();

    await expect.poll(() => locales().join(","), { timeout: 10_000 }).toBe("en,ar");
    const arabicScreens = localeScreens("ar");
    const arabicScreenIds = arabicScreens.map((screen) => screen.id);
    const arabicOutputScreenIds = outputScreenIds(arabicScreens, arabicScreens[0]!);
    expect(arabicScreens.map((screen) => screen.name)).toEqual(sourceScreens.map((screen) => screen.name));
    expect(arabicScreens.every((screen) => screen.direction === "rtl")).toBe(true);
    expect(arabicScreenIds.every((id) => !sourceScreenIds.includes(id))).toBe(true);
    expect(arabicScreens.flatMap((screen) => screen.elements).every((element) => !sourceElementIds.has(element.id))).toBe(true);
    expect(arabicScreens[0]!.elements[0]!.x).toBe(
      sourceScreens[0]!.artboard.width - sourceFirstElement.x - sourceFirstElement.width,
    );
    expect(localeScreens("en")[0]!.elements[0]!.x).toBe(sourceFirstElement.x);

    const arabicList = page.getByRole("list", { name: "Screens for ar" });
    const overview = page.getByTestId("overview-artboards");
    await expect.poll(() => renderedIds(arabicList.locator("[data-screen-id]")))
      .toBe(arabicOutputScreenIds.join(","));
    await expect.poll(() => renderedIds(overview.locator("[data-screen-id]"))).toBe(arabicScreenIds.join(","));

    await selectLocale(page, "en");
    const englishList = page.getByRole("list", { name: "Screens for en" });
    await expect.poll(() => renderedIds(englishList.locator("[data-screen-id]")))
      .toBe(sourceOutputScreenIds.join(","));
    await expect.poll(() => renderedIds(overview.locator("[data-screen-id]"))).toBe(sourceScreenIds.join(","));
    await selectLocale(page, "ar");

    const arabicHero = localeScreens("ar")[0]!;
    const headline = arabicHero.elements.find((element) => element.name === "Hero headline")!;
    const heroCanvas = overview.locator(`[data-screen-id="${arabicHero.id}"] canvas`).first();
    const canvasBox = (await heroCanvas.boundingBox())!;
    const scale = canvasBox.width / arabicHero.artboard.width;
    await page.mouse.dblclick(
      canvasBox.x + (headline.x + headline.width / 2) * scale,
      canvasBox.y + (headline.y + headline.height / 2) * scale,
    );
    const inlineEditor = page.getByLabel("Edit Hero headline", { exact: true });
    await inlineEditor.waitFor({ state: "visible" });
    expect(await inlineEditor.getAttribute("dir")).toBe("rtl");
    await inlineEditor.fill("اشحنها الآن");
    await inlineEditor.press("Control+Enter");
    await expect.poll(
      () => localeScreens("ar")[0]!.elements.find((element) => element.name === "Hero headline")?.content,
      { timeout: 10_000 },
    ).toBe("اشحنها الآن");
    expect(localeScreens("en")[0]!.elements.find((element) => element.name === "Hero headline")?.content).toBe("Ship it");

    const activeBeforeInsert = localeScreens("ar")[0]!.elements.length;
    await page.getByRole("button", { name: "Add element" }).click();
    await page.getByRole("button", { name: "+ Text", exact: true }).click();
    await expect.poll(() => localeScreens("ar")[0]!.elements.length, { timeout: 10_000 }).toBe(activeBeforeInsert + 1);
    expect(localeScreens("ar")[0]!.elements.at(-1)).toMatchObject({ type: "text", align: "right" });

    await page.getByRole("button", { name: "Structure panel", exact: true }).click();
    const orderBefore = localeScreenIds("ar");
    const handle = arabicList.getByLabel("Drag to reorder").first();
    await handle.focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(200);
    await page.keyboard.press("Space");
    await expect.poll(() => localeScreenIds("ar").join(","), { timeout: 10_000 })
      .toBe([orderBefore[1], orderBefore[0], ...orderBefore.slice(2)].join(","));
    expect(localeScreenIds("en")).toEqual(sourceScreenIds);
    const rtlSnapshot = structuredClone(localeScreens("ar"));

    await page.getByRole("button", { name: "Manage locales" }).click();
    const reopenedManager = page.getByRole("dialog", { name: "Locale manager" });
    const arabicRow = reopenedManager.locator('[data-locale="ar"]');
    page.once("dialog", (dialog) => dialog.accept());
    await arabicRow.getByRole("button", { name: "Mirror ar to LTR" }).click();
    await expect.poll(
      () => localeScreens("ar").every((screen) => screen.direction === "ltr"),
      { timeout: 10_000 },
    ).toBe(true);
    expect(localeScreens("ar")).not.toEqual(rtlSnapshot);

    page.once("dialog", (dialog) => dialog.accept());
    await arabicRow.getByRole("button", { name: "Mirror ar to RTL" }).click();
    await expect.poll(() => roundedElementX(localeScreens("ar")), { timeout: 10_000 })
      .toEqual(roundedElementX(rtlSnapshot));

    page.once("dialog", (dialog) => dialog.accept());
    await arabicRow
      .getByRole("button", { name: "Delete locale ar" })
      .click();
    await expect.poll(() => locales().join(","), { timeout: 10_000 }).toBe("en");
    expect(localeScreenIds("en")).toEqual(sourceScreenIds);
    expect(await reopenedManager.locator('[data-locale="en"]')
      .getByRole("button", { name: "Delete locale en" })
      .isDisabled()).toBe(true);
    await reopenedManager.getByRole("button", { name: "Close locale manager" }).click();
    await expect.poll(() => renderedIds(overview.locator("[data-screen-id]")))
      .toBe(sourceScreenIds.join(","));

    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("canvas");
    await expect.poll(() => renderedIds(page.getByTestId("overview-artboards").locator("[data-screen-id]")))
      .toBe(sourceScreenIds.join(","));
    await page.setViewportSize({ width: 320, height: 800 });
    await page.getByRole("button", { name: "More toolbar actions" }).click();
    const localeOption = page.getByRole("menu", { name: "More toolbar actions" })
      .getByRole("menuitemradio", { name: "en" });
    const localeBounds = await localeOption.boundingBox();
    expect(localeBounds).not.toBeNull();
    expect(localeBounds!.x).toBeGreaterThanOrEqual(0);
    expect(localeBounds!.x + localeBounds!.width).toBeLessThanOrEqual(320);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.close();
  });
});
