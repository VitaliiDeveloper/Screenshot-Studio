// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startWebServer } from "@screenshot-studio/cli/server";
import { inspectPng, stripAlpha } from "@screenshot-studio/core/export";
import { Screen, setScreenDirection } from "@screenshot-studio/core/model";
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
  harness = await startParityRenderHarness(() => startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") }));
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
    checkerboard: false,
  });
}

function flipHorizontally(buffer: Buffer): Buffer {
  const png = PNG.sync.read(buffer);
  const flipped = new PNG({ width: png.width, height: png.height });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const from = (y * png.width + x) * 4;
      png.data.copy(flipped.data, (y * png.width + png.width - 1 - x) * 4, from, from + 4);
    }
  }
  return PNG.sync.write(flipped);
}

const transform = { opacity: 1, locked: false, visible: true };

describe("RTL render parity", () => {
  it("renders explicit RTL identically in headed and headless Chromium", async () => {
    const headed = stripAlpha(await harness.headed.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      layoutId: "default",
      screenId: "arabic-rtl",
      pixelRatio,
      timeoutMs: 60_000,
    }));
    const headless = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      layoutId: "default",
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
      layoutId: "default",
      screenId: "arabic-rtl",
      pixelRatio,
    }));
    const ltr = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      layoutId: "default",
      screenId: "arabic-ltr",
      pixelRatio,
    }));

    expect(countMismatch(rtl, ltr)).toBeGreaterThan(500);
  });

  it("renders a mirrored screen as the reflection of rotated, grouped and gradient art", async () => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const layout = fixture.layouts[0];
    const ltr = Screen.parse({
      ...layout.screens[0],
      id: "art-ltr",
      direction: "ltr",
      background: { type: "linear-gradient", from: "#1E3A8A", to: "#F59E0B", angle: 30 },
      elements: [
        {
          id: "card", type: "shape", kind: "rect", x: 80, y: 180, width: 320, height: 200, rotation: 25,
          radius: 24, fill: "#FFFFFF", gradient: { from: "#EC4899", to: "#22D3EE", angle: 20 }, ...transform,
        },
        {
          id: "orb", type: "shape", kind: "ellipse", x: 380, y: 620, width: 200, height: 120, rotation: -40,
          radius: 0, fill: "#10B981", ...transform,
        },
        {
          id: "cluster", type: "group", x: 120, y: 900, width: 360, height: 300, rotation: 15, ...transform,
          children: [
            {
              id: "bar", type: "shape", kind: "rect", x: 20, y: 30, width: 200, height: 120, rotation: 30,
              radius: 0, fill: "#F97316", gradient: { from: "#F97316", to: "#FDE047", angle: 300 }, ...transform,
            },
            {
              id: "dot", type: "shape", kind: "rect", x: 220, y: 160, width: 100, height: 60, rotation: 0,
              radius: 0, fill: "#A855F7", ...transform,
            },
          ],
        },
      ],
    });
    const rtl = { ...setScreenDirection(ltr, "rtl"), id: "art-rtl", locale: "ar" };
    const directory = mkdtempSync(join(tmpdir(), "rtl-mirror-"));
    const projectPath = join(directory, "app-store-screenshots.json");
    writeFileSync(projectPath, JSON.stringify({ ...fixture, fonts: [], layouts: [{ ...layout, screens: [ltr, rtl] }] }));
    try {
      const [ltrPng, rtlPng] = await Promise.all(["art-ltr", "art-rtl"].map(async (screenId) => stripAlpha(
        await harness.headless.renderScreenToPng({
          baseUrl: harness.server.url, projectPath, layoutId: "default", screenId, pixelRatio,
        }),
      )));
      for (const png of [ltrPng!, rtlPng!]) {
        expect(inspectPng(png)).toMatchObject({ ...target, hasAlpha: false });
      }
      const mismatch = countMismatch(flipHorizontally(ltrPng!), rtlPng!);
      expect(mismatch / (target.width * target.height)).toBeLessThan(MAX_MISMATCH_FRACTION);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
