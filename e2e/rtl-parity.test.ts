// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startWebServer } from "../packages/cli/src/server.js";
import { inspectPng, stripAlpha } from "../packages/core/src/export/png.js";
import {
  closeParityRenderHarness,
  startParityRenderHarness,
  type ParityRenderHarness,
} from "./support/parity-render-harness.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/regressions/rtl-parity/app-store-screenshots.json");
const pixelRatio = 2;
const target = { width: 1320, height: 2868 };
const MAX_MISMATCH_FRACTION = 0.001;

let harness: ParityRenderHarness;

beforeAll(async () => {
  harness = await startParityRenderHarness(() => startWebServer());
}, 180_000);

afterAll(async () => {
  await closeParityRenderHarness(harness);
});

function countMismatch(a: Buffer, b: Buffer): number {
  const first = PNG.sync.read(a);
  const second = PNG.sync.read(b);
  expect(first.width).toBe(second.width);
  expect(first.height).toBe(second.height);
  const diff = new PNG({ width: first.width, height: first.height });
  return pixelmatch(first.data, second.data, diff.data, first.width, first.height, {
    threshold: 0.1,
  });
}

describe("Phase 4 RTL render parity", () => {
  it("renders explicit RTL identically in headed and headless Chromium", async () => {
    const headed = stripAlpha(await harness.headed.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      screenId: "arabic-rtl",
      pixelRatio,
      timeoutMs: 60_000,
    }));
    const headless = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      screenId: "arabic-rtl",
      pixelRatio,
    }));

    for (const png of [headed, headless]) {
      expect(inspectPng(png)).toMatchObject({ ...target, hasAlpha: false });
    }

    const mismatch = countMismatch(headed, headless);
    expect(mismatch / (target.width * target.height)).toBeLessThan(MAX_MISMATCH_FRACTION);
  });

  it("proves the stored bidi direction changes mixed Arabic/numeral layout", async () => {
    const rtl = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      screenId: "arabic-rtl",
      pixelRatio,
    }));
    const ltr = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      screenId: "arabic-ltr",
      pixelRatio,
    }));

    expect(countMismatch(rtl, ltr)).toBeGreaterThan(500);
  });
});
