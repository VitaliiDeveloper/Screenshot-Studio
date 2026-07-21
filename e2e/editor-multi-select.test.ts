// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

const shape = (id: string, name: string, x: number, fill: string, locked = false) => ({
  id, name, type: "shape", x, y: 40, width: 40, height: 40, rotation: 0,
  opacity: 1, locked, visible: true, kind: "rect", fill, radius: 0,
});

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "editor-multi-select-"));
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Multi select", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Default", mode: "connected",
      screens: [
        {
          id: "first", name: "First", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
          artboard: { width: 300, height: 300 }, background: { type: "solid", color: "#FFFFFF" },
          elements: [shape("same", "Red", 40, "#FF0000"), shape("green", "Green", 120, "#00FF00")],
        },
        {
          id: "second", name: "Second", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
          artboard: { width: 300, height: 300 }, background: { type: "solid", color: "#F8FAFC" },
          elements: [shape("same", "Blue duplicate", 40, "#0000FF", true)],
        },
      ],
    }],
  }));
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

function project() {
  return JSON.parse(readFileSync(projectPath, "utf8")) as {
    layouts: Array<{ screens: Array<{
        id: string;
        elements: Array<{ id: string; x: number; y: number; locked: boolean; visible: boolean }>;
      }> }>;
  };
}

function element(screenId: string, elementId: string) {
  return project().layouts[0].screens.find((screen) => screen.id === screenId)!.elements
    .find((candidate) => candidate.id === elementId)!;
}

describe("multi-select foundation", () => {
  it("composes modified click, marquee, owner-local movement, batch actions, and keyboard deletion", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });

    const stage = page.getByTestId("editor-stage");
    const canvas = page.getByTestId("connected-artboards").locator("canvas").first();
    await canvas.waitFor({ state: "visible" });
    const box = (await canvas.boundingBox())!;
    const scale = box.width / 600;
    const point = (stageX: number, y: number) => ({ x: box.x + stageX * scale, y: box.y + y * scale });

    const red = point(60, 60);
    const green = point(140, 60);
    const blue = point(360, 60);
    await page.mouse.click(red.x, red.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(green.x, green.y);
    await page.keyboard.up("Shift");
    await expect.poll(() => stage.getAttribute("data-selection-count")).toBe("2");
    await page.getByText("2 elements", { exact: true }).waitFor({ state: "visible" });

    // A plain click in the workspace outside every artboard clears the same shared selection.
    const workspace = page.getByRole("region", { name: "Canvas workspace" });
    const workspaceBox = (await workspace.boundingBox())!;
    await page.mouse.click(workspaceBox.x + workspaceBox.width - 24, workspaceBox.y + workspaceBox.height - 24);
    await expect.poll(() => stage.getAttribute("data-selection-count")).toBe("0");
    await page.mouse.click(red.x, red.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(green.x, green.y);
    await page.keyboard.up("Shift");
    await expect.poll(() => stage.getAttribute("data-selection-count")).toBe("2");

    const blank = point(220, 220);
    await page.mouse.click(blank.x, blank.y);
    await expect.poll(() => stage.getAttribute("data-selection-count")).toBe("0");
    await page.mouse.click(red.x, red.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(green.x, green.y);
    await page.keyboard.up("Shift");
    await expect.poll(() => stage.getAttribute("data-selection-count")).toBe("2");

    const redStart = element("first", "same");
    const greenStart = element("first", "green");
    await page.mouse.move(red.x, red.y);
    await page.mouse.down();
    await page.mouse.move(red.x + 25 * scale, red.y + 10 * scale, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => element("first", "same").x).toBeCloseTo(redStart.x + 25, 0);
    expect(element("first", "green")).toMatchObject({
      x: expect.closeTo(greenStart.x + 25, 0),
      y: expect.closeTo(greenStart.y + 10, 0),
    });

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(() => element("first", "same").x).toBe(redStart.x);
    expect(element("first", "green")).toMatchObject({ x: greenStart.x, y: greenStart.y });

    // Plain blank drag replaces selection with the two intersecting first-owner elements.
    const marqueeStart = point(20, 20);
    const marqueeEnd = point(180, 100);
    await page.mouse.move(marqueeStart.x, marqueeStart.y);
    await page.mouse.down();
    await page.mouse.move(marqueeEnd.x, marqueeEnd.y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => stage.getAttribute("data-selection-count")).toBe("2");

    // Duplicate ids on different owners remain distinct; the locked duplicate joins the set.
    await page.keyboard.down("Shift");
    await page.mouse.click(blue.x, blue.y);
    await page.keyboard.up("Shift");
    await expect.poll(() => stage.getAttribute("data-selection-count")).toBe("3");

    await page.getByRole("button", { name: "Lock", exact: true }).click();
    await expect.poll(() => project().layouts[0].screens.every(
      (screen) => screen.elements.every((candidate) => candidate.locked),
    )).toBe(true);

    await page.getByRole("button", { name: "Hide", exact: true }).click();
    await expect.poll(() => project().layouts[0].screens.every(
      (screen) => screen.elements.every((candidate) => !candidate.visible),
    )).toBe(true);
    await expect.poll(() => stage.getAttribute("data-selection-count")).toBe("0");

    // Hidden items remain addressable from Layers and can be shown as a batch.
    const firstBackground = point(220, 220);
    await page.mouse.click(firstBackground.x, firstBackground.y);
    await page.getByRole("list", { name: "Layers for First" }).waitFor({ state: "visible" });
    const redLayer = page.getByRole("button", { name: "Red", exact: true });
    const greenLayer = page.getByRole("button", { name: "Green", exact: true });
    await redLayer.click();
    await greenLayer.click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await expect.poll(() => element("first", "same").visible && element("first", "green").visible).toBe(true);

    await redLayer.click();
    await greenLayer.click({ modifiers: ["Shift"] });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Delete");
    await expect.poll(() => project().layouts[0].screens.find((screen) => screen.id === "first")!.elements.length).toBe(0);
    expect(project().layouts[0].screens.find((screen) => screen.id === "second")!.elements).toHaveLength(1);

    await page.close();
  });
});
