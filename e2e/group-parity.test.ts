// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { stripAlpha } from "../packages/core/src/export/png.js";
import { renderScreenToPng } from "../packages/cli/src/render-driver.js";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/phase-7-group/app-store-screenshots.json");
const pixelRatio = 2;
const target = { width: 600, height: 600 };
const MAX_MISMATCH_FRACTION = 0.001;

let server: RunningServer;
let browser: Browser;

beforeAll(async () => {
  process.env.PROJECT_PATH = fixturePath;
  server = await startWebServer();
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
});

function pixel(png: PNG, x: number, y: number): [number, number, number] {
  const offset = (y * png.width + x) * 4;
  return [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!];
}

function mismatch(first: Buffer, second: Buffer): number {
  const a = PNG.sync.read(first);
  const b = PNG.sync.read(second);
  expect({ width: a.width, height: a.height }).toEqual({ width: b.width, height: b.height });
  const diff = new PNG({ width: a.width, height: a.height });
  return pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
}

describe("Phase 7 group render parity", () => {
  it("matches headed/headless exact crops and the interactive shared node tree", async () => {
    const headedSecond = stripAlpha(await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId: "group-second",
      pixelRatio,
      headless: false,
      timeoutMs: 60_000,
    }));
    const headlessSecond = stripAlpha(await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId: "group-second",
      pixelRatio,
      headless: true,
    }));
    const headlessFirst = stripAlpha(await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId: "group-first",
      pixelRatio,
      headless: true,
    }));

    for (const bytes of [headedSecond, headlessSecond, headlessFirst]) {
      const png = PNG.sync.read(bytes);
      expect({ width: png.width, height: png.height }).toEqual(target);
    }
    const first = PNG.sync.read(headlessFirst);
    const second = PNG.sync.read(headlessSecond);
    expect(pixel(first, 540, 220)).toEqual([0, 255, 0]);
    expect(pixel(second, 40, 220)).toEqual([255, 0, 0]);
    expect(pixel(second, 500, 100)).toEqual([32, 32, 32]);
    expect(mismatch(headedSecond, headlessSecond) / (target.width * target.height))
      .toBeLessThan(MAX_MISMATCH_FRACTION);

    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const stage = page.getByTestId("editor-stage");
    await stage.waitFor({ state: "visible" });
    const canvas = stage.locator("canvas").first();
    await expect.poll(() => canvas.count()).toBe(1);
    const interactivePixels = await canvas.evaluate((node: HTMLCanvasElement) => {
      const context = node.getContext("2d")!;
      const sample = (x: number, y: number) => Array.from(context.getImageData(
        Math.round(x * node.width / 600),
        Math.round(y * node.height / 300),
        1,
        1,
      ).data.slice(0, 3));
      return { green: sample(270, 110), red: sample(320, 110) };
    });
    expect(interactivePixels.green).toEqual([0, 255, 0]);
    expect(interactivePixels.red).toEqual([255, 0, 0]);

    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + 270 * box.width / 600, box.y + 110 * box.height / 300);
    await page.getByText("2 children. Resize stays uniform to preserve child transforms.", { exact: true })
      .waitFor({ state: "visible" });
    await page.close();
  });
});
