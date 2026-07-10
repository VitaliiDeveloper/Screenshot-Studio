// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { stripAlpha } from "../packages/core/src/export/png.js";
import { renderScreenToPng } from "../packages/cli/src/render-driver.js";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/phase-6-connected/app-store-screenshots.json");
const pixelRatio = 2;
const target = { width: 1320, height: 2868 };
const MAX_MISMATCH_FRACTION = 0.001;

let server: RunningServer;

beforeAll(async () => {
  server = await startWebServer();
}, 180_000);

afterAll(async () => {
  await server?.stop();
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

describe("Phase 6 connected crop parity", () => {
  it("matches headed/headless and carries one owner element across both exact screen crops", async () => {
    const headedSecond = stripAlpha(await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId: "connected-second",
      pixelRatio,
      headless: false,
      timeoutMs: 60_000,
    }));
    const headlessSecond = stripAlpha(await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId: "connected-second",
      pixelRatio,
      headless: true,
    }));
    const headlessFirst = stripAlpha(await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId: "connected-first",
      pixelRatio,
      headless: true,
    }));

    for (const bytes of [headedSecond, headlessSecond, headlessFirst]) {
      const png = PNG.sync.read(bytes);
      expect({ width: png.width, height: png.height }).toEqual(target);
    }

    const first = PNG.sync.read(headlessFirst);
    const second = PNG.sync.read(headlessSecond);
    expect(pixel(first, 1200, 500)).toEqual([255, 0, 0]);
    expect(pixel(second, 100, 500)).toEqual([255, 0, 0]);
    expect(pixel(second, 400, 500)).toEqual([32, 32, 32]);

    const mismatchFraction = mismatch(headedSecond, headlessSecond) / (target.width * target.height);
    expect(mismatchFraction).toBeLessThan(MAX_MISMATCH_FRACTION);
  });
});
