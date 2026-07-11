// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

const shape = (id: string, name: string, x: number, fill: string) => ({
  id, name, type: "shape", x, y: 40, width: 40, height: 40, rotation: 0,
  opacity: 1, locked: false, visible: true, kind: "rect", fill, radius: 4,
});

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "group-authoring-"));
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Group authoring", schemaVersion: 6 },
    mode: "connected",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "first", name: "First", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 300, height: 300 }, background: { type: "solid", color: "#FFFFFF" },
        elements: [shape("red", "Red", 40, "#FF0000"), shape("green", "Green", 120, "#00FF00")],
      },
      {
        id: "second", name: "Second", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 300, height: 300 }, background: { type: "solid", color: "#F8FAFC" },
        elements: [shape("blue", "Blue", 40, "#0000FF")],
      },
    ],
  }));
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

interface PersistedElement {
  id: string;
  name?: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked: boolean;
  children?: PersistedElement[];
  fill?: string;
}

function project() {
  return JSON.parse(readFileSync(projectPath, "utf8")) as {
    screens: Array<{ id: string; elements: PersistedElement[] }>;
  };
}

function firstElements() {
  return project().screens.find((screen) => screen.id === "first")!.elements;
}

describe("Phase 7 group authoring", () => {
  it("groups, inspects children, resizes, duplicates, ungroups, and persists through reload", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });

    const stage = page.getByTestId("editor-stage");
    const layers = page.getByRole("list", { name: "Layers for First" });
    await layers.waitFor({ state: "visible" });
    await layers.getByRole("button", { name: "Red", exact: true }).click();
    await layers.getByRole("button", { name: "Green", exact: true }).click({ modifiers: ["Shift"] });
    await expect.poll(() => stage.getAttribute("data-selection-count")).toBe("2");

    await page.getByRole("button", { name: "Group", exact: true }).click();
    await expect.poll(() => firstElements()[0]?.type).toBe("group");
    let group = firstElements()[0]!;
    expect(group).toMatchObject({ name: "Group", x: 40, y: 40, width: 120, height: 40 });
    expect(group.children?.map((child) => ({ id: child.id, x: child.x })))
      .toEqual([{ id: "red", x: 0 }, { id: "green", x: 80 }]);

    await page.getByLabel("Width", { exact: true }).fill("240");
    await page.getByLabel("Width", { exact: true }).blur();
    await expect.poll(() => firstElements()[0]?.width).toBe(240);
    group = firstElements()[0]!;
    expect(group.height).toBe(80);
    expect(group.children?.[1]).toMatchObject({ x: 160, width: 80, height: 80 });

    const groupLayer = layers.getByRole("button", { name: "Group", exact: true });
    await groupLayer.dblclick();
    const rename = layers.locator("input");
    await rename.fill("Hero cluster");
    await rename.press("Enter");
    await expect.poll(() => firstElements()[0]?.name).toBe("Hero cluster");

    const greenLayer = layers.getByRole("button", { name: "Green", exact: true });
    const fillField = page.getByLabel("Fill", { exact: true });
    await greenLayer.click();
    try {
      await fillField.waitFor({ state: "visible", timeout: 2_000 });
    } catch {
      // A save-triggered Layers rerender can replace the button immediately after the first click.
      await greenLayer.click();
      await fillField.waitFor({ state: "visible" });
    }
    await fillField.fill("#112233");
    await fillField.blur();
    await expect.poll(() => firstElements()[0]?.children?.[1]?.fill).toBe("#112233");

    const renamedLayer = layers.getByRole("button", { name: "Hero cluster", exact: true });
    await renamedLayer.click();
    await page.getByRole("button", { name: "More actions for Hero cluster" }).click();
    await page.getByRole("menuitem", { name: "Lock layer" }).click();
    await expect.poll(() => firstElements()[0]?.locked).toBe(true);
    await page.getByRole("button", { name: "More actions for Hero cluster" }).click();
    await page.getByRole("menuitem", { name: "Unlock layer" }).click();
    await expect.poll(() => firstElements()[0]?.locked).toBe(false);

    await renamedLayer.click();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Control+d");
    await expect.poll(() => firstElements().length).toBe(2);
    const [original, copy] = firstElements();
    expect(copy).toMatchObject({ name: "Hero cluster copy", x: original!.x + 20, y: original!.y + 20 });
    expect(copy!.id).not.toBe(original!.id);
    expect(copy!.children?.map((child) => child.id)).not.toEqual(original!.children?.map((child) => child.id));

    await page.keyboard.press("Control+Shift+g");
    await expect.poll(() => firstElements().length).toBe(3);
    expect(firstElements().map((element) => element.type)).toEqual(["group", "shape", "shape"]);

    await page.keyboard.press("Control+z");
    await expect.poll(() => firstElements().length).toBe(2);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(() => firstElements().length).toBe(3);

    await page.reload({ waitUntil: "load" });
    await page.getByRole("list", { name: "Layers for First" }).waitFor({ state: "visible" });
    expect(firstElements().map((element) => element.type)).toEqual(["group", "shape", "shape"]);
    expect(firstElements()[0]?.name).toBe("Hero cluster");
    await page.close();
  });
});
