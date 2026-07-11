// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { createBadgePrimitive } from "../packages/core/src/model/badge-primitives.js";
import { stripAlpha } from "../packages/core/src/export/png.js";
import { startWebServer } from "../packages/cli/src/server.js";
import {
  closeParityRenderHarness,
  startParityRenderHarness,
  type ParityRenderHarness,
} from "./support/parity-render-harness.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fontSource = resolve(repoRoot, "fixtures/phase-0-sample/assets/fonts/Pacifico-Regular.ttf");
const MAX_MISMATCH_FRACTION = 0.002;

let harness: ParityRenderHarness;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "badge-parity-"));
  mkdirSync(join(directory, "assets", "fonts"), { recursive: true });
  cpSync(fontSource, join(directory, "assets", "fonts", "pacifico.ttf"));
  projectPath = join(directory, "app-store-screenshots.json");
  const font = { family: "Pacifico", weight: 400 };
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Badge parity", schemaVersion: 6 },
    mode: "connected",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [{ ...font, source: "uploaded", path: "assets/fonts/pacifico.ttf" }],
    screens: [
      {
        id: "first", name: "First", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 500, height: 320 }, background: { type: "solid", color: "#FFFFFF" },
        elements: [
          createBadgePrimitive({ kind: "rating", font, x: 20, y: 20 }),
          createBadgePrimitive({ kind: "as-seen-on", font, x: 420, y: 160 }),
        ],
      },
      {
        id: "second", name: "Second", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 500, height: 320 }, background: { type: "solid", color: "#00FF00" },
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

describe("Phase 7 badge composition parity", () => {
  it("matches generated group pixels in static, UI, headed/headless, and connected crops", async () => {
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
    const headed = PNG.sync.read(headedSecond);
    expect(rgb(first, 50, 50)).toEqual([17, 24, 39]);
    expect(rgb(first, 450, 180)).toEqual([248, 250, 252]);
    expect(rgb(second, 50, 180)).toEqual([248, 250, 252]);
    const diff = new PNG({ width: second.width, height: second.height });
    const mismatch = pixelmatch(
      second.data,
      headed.data,
      diff.data,
      second.width,
      second.height,
      { threshold: 0.1 },
    );
    expect(mismatch / (second.width * second.height)).toBeLessThan(MAX_MISMATCH_FRACTION);

    const page = await harness.interactive!.newPage({ viewport: { width: 1400, height: 800 } });
    await page.goto(`${harness.server.url}/editor`, { waitUntil: "load" });
    const canvas = page.getByTestId("connected-artboards").locator("canvas").first();
    await canvas.waitFor({ state: "visible" });
    const samples = await canvas.evaluate((node: HTMLCanvasElement) => {
      const context = node.getContext("2d")!;
      const sample = (x: number, y: number) => Array.from(context.getImageData(
        Math.round(x * node.width / 1000),
        Math.round(y * node.height / 320),
        1,
        1,
      ).data.slice(0, 3));
      return { rating: sample(50, 50), firstBadge: sample(450, 180), secondBadge: sample(550, 180) };
    });
    expect(samples).toEqual({
      rating: [17, 24, 39],
      firstBadge: [248, 250, 252],
      secondBadge: [248, 250, 252],
    });
    await page.close();
  });
});
