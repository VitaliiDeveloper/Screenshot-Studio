// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { stripAlpha } from "../packages/core/src/export/png.js";
import { startWebServer } from "../packages/cli/src/server.js";
import {
  closeParityRenderHarness,
  startParityRenderHarness,
  type ParityRenderHarness,
} from "./support/parity-render-harness.js";

let harness: ParityRenderHarness;
let directory: string;
let projectPath: string;

function transparentFixture(): Buffer {
  const png = new PNG({ width: 100, height: 50 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = 255;
      png.data[offset + 1] = 0;
      png.data[offset + 2] = 0;
      png.data[offset + 3] = x < 50 ? 255 : 0;
    }
  }
  return PNG.sync.write(png);
}

const image = (id: string, x: number, y: number, fit: "contain" | "cover") => ({
  id, type: "image", x, y, width: 100, height: 100, rotation: 0,
  opacity: 1, locked: false, visible: true,
  assetUrl: "assets/decor.png", fit, cornerRadius: 0,
});

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "image-parity-"));
  mkdirSync(join(directory, "assets"), { recursive: true });
  writeFileSync(join(directory, "assets", "decor.png"), transparentFixture());
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Image parity", schemaVersion: 6 },
    mode: "connected",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "first", name: "First", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 200, height: 200 }, background: { type: "solid", color: "#0000FF" },
        elements: [
          image("contain", 20, 20, "contain"),
          {
            id: "image-group", type: "group", x: 150, y: 100, width: 100, height: 100,
            rotation: 0, opacity: 1, locked: false, visible: true,
            children: [image("group-cover", 0, 0, "cover")],
          },
        ],
      },
      {
        id: "second", name: "Second", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 200, height: 200 }, background: { type: "solid", color: "#00FF00" },
        elements: [image("cover", 20, 20, "cover")],
      },
    ],
  }));
  process.env.PROJECT_PATH = projectPath;
  harness = await startParityRenderHarness(() => startWebServer(), () => chromium.launch());
}, 180_000);

afterAll(async () => {
  await closeParityRenderHarness(harness);
  delete process.env.PROJECT_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function rgb(png: PNG, x: number, y: number): [number, number, number] {
  const offset = (y * png.width + x) * 4;
  return [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!];
}

describe("Phase 7 decorative image parity", () => {
  it("matches UI/CLI pixels for contain, cover, alpha, groups, and connected crops", async () => {
    const firstBytes = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url, projectPath, screenId: "first", pixelRatio: 1,
    }));
    const secondBytes = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url, projectPath, screenId: "second", pixelRatio: 1,
    }));
    const headedSecond = stripAlpha(await harness.headed.renderScreenToPng({
      baseUrl: harness.server.url, projectPath, screenId: "second", pixelRatio: 1,
      timeoutMs: 60_000,
    }));
    const first = PNG.sync.read(firstBytes);
    const second = PNG.sync.read(secondBytes);
    expect({ width: first.width, height: first.height }).toEqual({ width: 200, height: 200 });
    expect(rgb(first, 30, 30)).toEqual([0, 0, 255]);
    expect(rgb(first, 30, 60)).toEqual([255, 0, 0]);
    expect(rgb(second, 30, 60)).toEqual([255, 0, 0]);
    expect(rgb(second, 100, 60)).toEqual([0, 255, 0]);
    expect(rgb(first, 170, 150)).toEqual([255, 0, 0]);
    expect(rgb(second, 30, 150)).toEqual([0, 255, 0]);

    const headed = PNG.sync.read(headedSecond);
    const diff = new PNG({ width: second.width, height: second.height });
    expect(pixelmatch(second.data, headed.data, diff.data, second.width, second.height, { threshold: 0.1 }))
      .toBe(0);

    const page = await harness.interactive!.newPage({ viewport: { width: 1200, height: 700 } });
    await page.goto(`${harness.server.url}/editor`, { waitUntil: "load" });
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
        containMargin: sample(30, 30),
        containRed: sample(30, 60),
        coverRed: sample(230, 60),
        coverAlpha: sample(300, 60),
        groupedRed: sample(170, 150),
        groupedAlpha: sample(230, 150),
      };
    });
    expect(samples).toEqual({
      containMargin: [0, 0, 255],
      containRed: [255, 0, 0],
      coverRed: [255, 0, 0],
      coverAlpha: [0, 255, 0],
      groupedRed: [255, 0, 0],
      groupedAlpha: [0, 255, 0],
    });
    await page.close();
  });
});
