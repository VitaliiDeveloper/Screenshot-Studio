// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { stripAlpha } from "../packages/core/src/export/png.js";
import { startWebServer } from "../packages/cli/src/server.js";
import {
  closeParityRenderHarness,
  startParityRenderHarness,
  type ParityRenderHarness,
} from "./support/parity-render-harness.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/regressions/connected-canvas/app-store-screenshots.json");
const pixelRatio = 2;
const target = { width: 1320, height: 2868 };
const MAX_MISMATCH_FRACTION = 0.001;

let harness: ParityRenderHarness;

beforeAll(async () => {
  harness = await startParityRenderHarness(() => startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") }));
}, 180_000);

afterAll(async () => {
  await closeParityRenderHarness(harness);
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

describe("connected crop parity", () => {
  it("matches headed/headless and carries one owner element across both exact screen crops", async () => {
    const headedSecond = stripAlpha(await harness.headed.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      layoutId: "default",
      screenId: "connected-second",
      pixelRatio,
      timeoutMs: 60_000,
    }));
    const headlessSecond = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      layoutId: "default",
      screenId: "connected-second",
      pixelRatio,
    }));
    const headlessFirst = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      layoutId: "default",
      screenId: "connected-first",
      pixelRatio,
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
