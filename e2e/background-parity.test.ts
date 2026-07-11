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

function transparentBackground(): Buffer {
  const png = new PNG({ width: 100, height: 100 });
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

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "background-parity-"));
  mkdirSync(join(directory, "assets"), { recursive: true });
  writeFileSync(join(directory, "assets", "background.png"), transparentBackground());
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Background parity", schemaVersion: 7 },
    mode: "connected",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "gradient", name: "Gradient", platform: "apple", device: "iphone",
        locale: "en", direction: "ltr", artboard: { width: 200, height: 200 },
        background: { type: "linear-gradient", from: "#000000", to: "#FFFFFF", angle: 0 },
        elements: [],
      },
      {
        id: "image", name: "Image", platform: "apple", device: "iphone",
        locale: "en", direction: "ltr", artboard: { width: 200, height: 200 },
        background: {
          type: "image", assetUrl: "assets/background.png", fit: "contain", color: "#00FF00",
        },
        elements: [],
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

describe("Phase 9 background parity", () => {
  it("matches UI/CLI pixels for gradient, image alpha, and connected crops", async () => {
    const gradientBytes = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url, projectPath, screenId: "gradient", pixelRatio: 1,
    }));
    const imageBytes = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url, projectPath, screenId: "image", pixelRatio: 1,
    }));
    const headedImage = stripAlpha(await harness.headed.renderScreenToPng({
      baseUrl: harness.server.url, projectPath, screenId: "image", pixelRatio: 1,
      timeoutMs: 60_000,
    }));
    const gradient = PNG.sync.read(gradientBytes);
    const image = PNG.sync.read(imageBytes);
    expect({ width: gradient.width, height: gradient.height }).toEqual({ width: 200, height: 200 });
    expect(rgb(gradient, 10, 100)[0]).toBeLessThan(20);
    expect(rgb(gradient, 190, 100)[0]).toBeGreaterThan(235);
    expect(rgb(image, 25, 100)).toEqual([255, 0, 0]);
    expect(rgb(image, 175, 100)).toEqual([0, 255, 0]);

    const headed = PNG.sync.read(headedImage);
    const diff = new PNG({ width: image.width, height: image.height });
    expect(pixelmatch(image.data, headed.data, diff.data, image.width, image.height, { threshold: 0.1 }))
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
      return { gradientLeft: sample(10, 100), gradientRight: sample(190, 100), image: sample(225, 100), alpha: sample(375, 100) };
    });
    expect(samples.gradientLeft[0]).toBeLessThan(20);
    expect(samples.gradientRight[0]).toBeGreaterThan(235);
    expect(samples.image).toEqual([255, 0, 0]);
    expect(samples.alpha).toEqual([0, 255, 0]);
    await page.close();
  });
});
