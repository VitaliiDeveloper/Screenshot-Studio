// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { stripAlpha } from "@screenshot-studio/core/export";
import { cloneLocaleSet, parseProjectJson } from "@screenshot-studio/core/model";
import { startWebServer } from "@screenshot-studio/cli/server";
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
  return pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1, checkerboard: false });
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

  it("exports an RTL clone as the exact mirror of the LTR strip, keeping the seam continuous", async () => {
    const directory = mkdtempSync(join(tmpdir(), "connected-canvas-rtl-"));
    try {
      const rtlPath = join(directory, "app-store-screenshots.json");
      const source = parseProjectJson(readFileSync(fixturePath, "utf8"));
      const rtl = cloneLocaleSet(source, "default", "en", "ar", "rtl");
      writeFileSync(rtlPath, JSON.stringify(rtl));
      const [arFirst, arSecond] = rtl.layouts[0]!.screens.filter(({ locale, platform }) => locale === "ar" && platform === "apple");

      const crop = async (projectPath: string, screenId: string) => PNG.sync.read(stripAlpha(await harness.headless.renderScreenToPng({
        baseUrl: harness.server.url,
        projectPath,
        layoutId: "default",
        screenId,
        pixelRatio,
      })));
      const ltrStrip = [await crop(fixturePath, "connected-first"), await crop(fixturePath, "connected-second")];
      const rtlStrip = [await crop(rtlPath, arSecond!.id), await crop(rtlPath, arFirst!.id)];
      for (const png of rtlStrip) expect({ width: png.width, height: png.height }).toEqual(target);

      const stitched = (crops: PNG[], flip: boolean) => {
        const out = new PNG({ width: target.width * 2, height: target.height });
        crops.forEach((png, index) => PNG.bitblt(png, out, 0, 0, target.width, target.height, index * target.width, 0));
        if (flip) {
          for (let y = 0; y < out.height; y += 1) {
            for (let x = 0; x < out.width / 2; x += 1) {
              const left = (y * out.width + x) * 4;
              const right = (y * out.width + out.width - 1 - x) * 4;
              for (let channel = 0; channel < 4; channel += 1) {
                const held = out.data[left + channel]!;
                out.data[left + channel] = out.data[right + channel]!;
                out.data[right + channel] = held;
              }
            }
          }
        }
        return out;
      };
      const expected = stitched(ltrStrip, false);
      const actual = stitched(rtlStrip, true);
      const diff = new PNG({ width: expected.width, height: expected.height });
      const mismatched = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: 0.1 });
      expect(mismatched / (expected.width * expected.height)).toBeLessThan(MAX_MISMATCH_FRACTION);
      // The bridge continues out of the first screen's left edge into the second screen's right edge.
      expect(pixel(rtlStrip[1]!, 100, 500)).toEqual([255, 0, 0]);
      expect(pixel(rtlStrip[0]!, target.width - 100, 500)).toEqual([255, 0, 0]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
