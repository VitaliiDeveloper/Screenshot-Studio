// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exampleRoot = resolve(repoRoot, "examples/rtl-delivery");

interface PersistedElement {
  id: string;
  name?: string;
  type: string;
  children?: PersistedElement[];
}

interface PersistedProject {
  screens: Array<{
    id: string;
    locale: string;
    elements: PersistedElement[];
  }>;
}

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "phase7-baseline-"));
  const projectRoot = join(directory, "rtl-delivery");
  cpSync(exampleRoot, projectRoot, { recursive: true });
  projectPath = join(projectRoot, "app-store-screenshots.json");
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

function project(): PersistedProject {
  return JSON.parse(readFileSync(projectPath, "utf8")) as PersistedProject;
}

function firstLocaleScreen(locale: string) {
  return project().screens.find((screen) => screen.locale === locale)!;
}

async function selectLocale(page: Page, locale: string): Promise<void> {
  await page.getByRole("button", { name: /^Active locale:/ }).click();
  await page.getByRole("menu", { name: "Project locales" })
    .getByRole("menuitemradio", { name: locale, exact: true })
    .click();
}

async function selectPair(page: Page, listName: string, first: string, second: string) {
  const layers = page.getByRole("list", { name: listName });
  await layers.waitFor({ state: "visible" });
  await layers.getByRole("button", { name: first, exact: true }).click();
  await layers.getByRole("button", { name: second, exact: true }).click({ modifiers: ["Shift"] });
  await expect.poll(() => page.getByTestId("editor-stage").getAttribute("data-selection-count"))
    .toBe("2");
}

describe("Phase 7 baseline closure dogfood", () => {
  it("authors groups by keyboard across connected LTR and RTL locales with accessible controls", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });

    await page.getByRole("button", { name: "Active locale: en" }).waitFor({ state: "visible" });
    await selectPair(page, "Layers for Arabic LTR baseline", "LTR accent", "LTR title");
    const groupButton = page.getByRole("button", { name: "Group", exact: true });
    expect(await groupButton.getAttribute("aria-keyshortcuts")).toBe("Control+G Meta+G");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Control+g");
    await expect.poll(() => firstLocaleScreen("en").elements[0]?.type).toBe("group");

    const duplicateButton = page.getByRole("button", { name: "Duplicate", exact: true });
    const ungroupButton = page.getByRole("button", { name: "Ungroup", exact: true });
    expect(await duplicateButton.getAttribute("aria-keyshortcuts")).toBe("Control+D Meta+D");
    expect(await ungroupButton.getAttribute("aria-keyshortcuts"))
      .toBe("Control+Shift+G Meta+Shift+G");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Control+d");
    await expect.poll(() => firstLocaleScreen("en").elements.filter(({ type }) => type === "group").length)
      .toBe(3);
    await page.keyboard.press("Control+Shift+g");
    await expect.poll(() => firstLocaleScreen("en").elements.filter(({ type }) => type === "group").length)
      .toBe(2);
    await page.keyboard.press("Control+z");
    await expect.poll(() => firstLocaleScreen("en").elements.filter(({ type }) => type === "group").length)
      .toBe(3);

    await selectLocale(page, "ar");
    await page.getByRole("button", { name: "Active locale: ar" }).waitFor({ state: "visible" });
    await selectPair(page, "Layers for Arabic RTL", "RTL accent", "RTL title");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Control+g");
    await expect.poll(() => firstLocaleScreen("ar").elements[0]?.type).toBe("group");
    await page.keyboard.press("Control+z");
    await expect.poll(() => firstLocaleScreen("ar").elements[0]?.type).toBe("shape");
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(() => firstLocaleScreen("ar").elements[0]?.type).toBe("group");

    await page.reload({ waitUntil: "load" });
    await selectLocale(page, "ar");
    const layers = page.getByRole("list", { name: "Layers for Arabic RTL" });
    await layers.getByRole("button", { name: "Group", exact: true }).waitFor({ state: "visible" });
    await layers.getByRole("button", { name: "RTL accent", exact: true })
      .waitFor({ state: "visible" });
    await layers.getByRole("button", { name: "RTL title", exact: true })
      .waitFor({ state: "visible" });
    expect(firstLocaleScreen("en").elements.filter(({ type }) => type === "group")).toHaveLength(3);
    expect(firstLocaleScreen("ar").elements[0]?.children?.map(({ name }) => name))
      .toEqual(["RTL accent", "RTL title"]);
    await page.close();
  }, 180_000);
});
