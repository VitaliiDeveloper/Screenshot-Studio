// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/regressions/connected-canvas/app-store-screenshots.json");

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "connected-editor-"));
  projectPath = join(directory, "app-store-screenshots.json");
  const project = JSON.parse(readFileSync(fixturePath, "utf8"));
  project.layouts[0].screens[1].elements.push({
    id: "cross-copy",
    type: "text",
    x: 50,
    y: 900,
    width: 300,
    height: 120,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    name: "Cross text",
    content: "Second owner",
    fontFamily: "sans-serif",
    size: 48,
    weight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: "left",
    color: "#FFFFFF"
  });
  writeFileSync(projectPath, JSON.stringify(project));
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
        elements: Array<{ id: string; x: number; content?: string }>;
      }> }>;
  };
}

describe("Phase 6 connected editor stage", () => {
  it("edits one gapless group with owner-local transforms and exact Focus crop", async () => {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });

    const connected = page.getByTestId("connected-artboards");
    await connected.waitFor({ state: "visible" });
    await expect.poll(() => connected.locator("canvas").count()).toBeGreaterThan(0);
    expect(await connected.getByText("Connected First", { exact: true }).count()).toBe(1);
    expect(await connected.getByText("Connected Second", { exact: true }).count()).toBe(1);
    expect(await connected.getByText("Unrelated", { exact: true }).count()).toBe(0);

    const structureToggle = page.getByRole("button", { name: "Structure panel", exact: true });
    if ((await structureToggle.getAttribute("aria-pressed")) !== "true") await structureToggle.click();

    const canvas = connected.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    const scale = box.width / 1320;
    const bridgeX = box.x + 700 * scale;
    const bridgeY = box.y + 300 * scale;

    // Click the part of Screen 1's element that is visibly cropped into Screen 2. Selection must
    // resolve to its owner, so Layers switches to Connected First despite the click location.
    await page.mouse.click(bridgeX, bridgeY);
    await page.getByRole("list", { name: "Layers for Connected First" }).waitFor({ state: "visible" });

    await page.mouse.move(bridgeX, bridgeY);
    await page.mouse.down();
    await page.mouse.move(bridgeX + 60 * scale, bridgeY, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => {
      const first = project().layouts[0].screens.find((screen) => screen.id === "connected-first")!;
      return first.elements.find((element) => element.id === "bridge")!.x;
    }).toBeCloseTo(620, 0);

    // A connected text element uses strip-space overlay placement but persists to its owner screen.
    const textX = box.x + (660 + 200) * scale;
    const textY = box.y + 960 * scale;
    await page.mouse.dblclick(textX, textY);
    const editor = page.getByRole("textbox", { name: "Edit Cross text" });
    await editor.waitFor({ state: "visible" });
    await editor.fill("Connected copy");
    await editor.press("Control+Enter");
    await expect.poll(() => {
      const second = project().layouts[0].screens.find((screen) => screen.id === "connected-second")!;
      return second.elements.find((element) => element.id === "cross-copy")!.content;
    }).toBe("Connected copy");

    await page.getByRole("button", { name: "Focus" }).click();
    await page.getByTestId("focus-artboard").waitFor({ state: "visible" });
    expect(await page.getByTestId("connected-artboards").count()).toBe(0);
    const focusCanvas = page.getByTestId("focus-artboard").locator("canvas").first();
    const focusBox = (await focusCanvas.boundingBox())!;
    expect(focusBox.width / focusBox.height).toBeCloseTo(660 / 1434, 2);
    const focusPixel = await focusCanvas.evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d")!;
      const x = Math.round(100 * canvas.width / 660);
      const y = Math.round(300 * canvas.height / 1434);
      return Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3));
    });
    expect(focusPixel).toEqual([255, 0, 0]);

    await page.close();
  });
});
