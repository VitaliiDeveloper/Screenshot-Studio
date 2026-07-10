// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { stripAlpha } from "../packages/core/src/export/png.js";
import { renderScreenToPng } from "../packages/cli/src/render-driver.js";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

const icon = (
  id: string,
  iconId: "check" | "heart" | "sparkles" | "star",
  x: number,
  y: number,
  width: number,
  color: string,
) => ({
  id, type: "icon", x, y, width, height: width, rotation: 0,
  opacity: 1, locked: false, visible: true,
  icon: iconId, color, strokeWidth: 8,
});

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "icon-parity-"));
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Icon parity", schemaVersion: 5 },
    mode: "connected",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "first", name: "First", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 200, height: 200 }, background: { type: "solid", color: "#FFFFFF" },
        elements: [
          icon("check", "check", 20, 20, 96, "#FF0000"),
          {
            id: "icon-group", type: "group", x: 160, y: 100, width: 80, height: 80,
            rotation: 0, opacity: 1, locked: false, visible: true,
            children: [icon("group-check", "check", 0, 0, 80, "#FF00FF")],
          },
        ],
      },
      {
        id: "second", name: "Second", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 200, height: 200 }, background: { type: "solid", color: "#00FF00" },
        elements: [icon("heart", "heart", 20, 20, 96, "#0000FF")],
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

function rgb(png: PNG, x: number, y: number): [number, number, number] {
  const offset = (y * png.width + x) * 4;
  return [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!];
}

describe("Phase 7 trusted icon parity", () => {
  it("matches headed/headless exact crops and carries a grouped vector across owners", async () => {
    expect(JSON.parse(readFileSync(projectPath, "utf8")).meta.schemaVersion).toBe(5);
    const firstBytes = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath, screenId: "first", pixelRatio: 1, headless: true,
    }));
    const secondBytes = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath, screenId: "second", pixelRatio: 1, headless: true,
    }));
    const headedSecond = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath, screenId: "second", pixelRatio: 1, headless: false,
      timeoutMs: 60_000,
    }));
    const first = PNG.sync.read(firstBytes);
    const second = PNG.sync.read(secondBytes);
    const headed = PNG.sync.read(headedSecond);
    expect({ width: first.width, height: first.height }).toEqual({ width: 200, height: 200 });
    expect(rgb(first, 58, 92)[0]).toBeGreaterThan(200);
    expect(rgb(second, 68, 104)[2]).toBeGreaterThan(200);
    expect(rgb(first, 192, 160)).toEqual([255, 0, 255]);
    expect(rgb(second, 10, 140)).toEqual([255, 0, 255]);
    const diff = new PNG({ width: second.width, height: second.height });
    expect(pixelmatch(second.data, headed.data, diff.data, second.width, second.height, { threshold: 0.1 }))
      .toBe(0);

    const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const canvas = page.getByTestId("connected-artboards").locator("canvas").first();
    await canvas.waitFor({ state: "visible" });
    const samples = await canvas.evaluate((node: HTMLCanvasElement) => {
      const context = node.getContext("2d")!;
      const sample = (x: number, y: number) => Array.from(context.getImageData(
        Math.round(x * node.width / 400),
        Math.round(y * node.height / 200),
        1,
        1,
      ).data.slice(0, 3));
      return {
        check: sample(58, 92),
        heart: sample(268, 104),
        groupedFirst: sample(192, 160),
        groupedSecond: sample(210, 140),
      };
    });
    expect(samples.check[0]).toBeGreaterThan(200);
    expect(samples.heart[2]).toBeGreaterThan(200);
    expect(samples.groupedFirst).toEqual([255, 0, 255]);
    expect(samples.groupedSecond).toEqual([255, 0, 255]);
    await page.close();
  });
});
