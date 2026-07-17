// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startWebServer } from "../packages/cli/src/server.js";
import { stripAlpha, inspectPng } from "../packages/core/src/export/png.js";
import {
  closeParityRenderHarness,
  startParityRenderHarness,
  type ParityRenderHarness,
} from "./support/parity-render-harness.js";

/**
 * Foundational render/export parity gate. Proves, on the hardest parity case (embedded custom
 * font), that:
 *   1. the pipeline yields a PNG at the exact store target size,
 *   2. with no alpha channel,
 *   3. the "UI export" (headed) and "CLI export" (headless) renders diff within tolerance, and
 *   4. the embedded font is provably live — the render differs from a fallback render.
 *
 * Both renders go through the SAME served /render route via Stage.toDataURL; the only variable
 * between (3)'s two images is headed-vs-headless — exactly the risk decision A does not remove
 * by construction (docs/architecture.md §2).
 */

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = resolve(repoRoot, "fixtures/sample");
const fixturePath = resolve(fixtureRoot, "app-store-screenshots.json");
const screenId = "hero";
const pixelRatio = 1; // The living sample is already authored at the 1320×2868 lead size.
const target = { width: 1320, height: 2868 };

// Tolerances (spec §6): starting values, tuned once real diffs are observed.
const PER_PIXEL_THRESHOLD = 0.1;
const MAX_MISMATCH_FRACTION = 0.001; // 0.1% of pixels

let harness: ParityRenderHarness;

beforeAll(async () => {
  harness = await startParityRenderHarness(() => startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") }), () => chromium.launch());
}, 180_000);

afterAll(async () => {
  await closeParityRenderHarness(harness);
});

function decode(buf: Buffer): PNG {
  return PNG.sync.read(buf);
}

function countMismatch(a: Buffer, b: Buffer): { mismatch: number; total: number } {
  const pa = decode(a);
  const pb = decode(b);
  expect(pa.width).toBe(pb.width);
  expect(pa.height).toBe(pb.height);
  const diff = new PNG({ width: pa.width, height: pa.height });
  const mismatch = pixelmatch(pa.data, pb.data, diff.data, pa.width, pa.height, {
    threshold: PER_PIXEL_THRESHOLD,
  });
  return { mismatch, total: pa.width * pa.height };
}

describe("Phase 0 render/export parity", () => {
  it("headed and headless renders match at the exact target size with no alpha", async () => {
    const headedRaw = await harness.headed.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      layoutId: "default",
      screenId,
      pixelRatio,
      timeoutMs: 60_000,
    });
    const headlessRaw = await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url,
      projectPath: fixturePath,
      layoutId: "default",
      screenId,
      pixelRatio,
    });

    const headed = stripAlpha(headedRaw);
    const headless = stripAlpha(headlessRaw);

    // (1) exact dimensions, (2) no alpha
    for (const png of [headed, headless]) {
      const info = inspectPng(png);
      expect(info.width).toBe(target.width);
      expect(info.height).toBe(target.height);
      expect(info.hasAlpha).toBe(false);
    }

    // (3) visual diff within tolerance
    const { mismatch, total } = countMismatch(headed, headless);
    const fraction = mismatch / total;
    // Surface the observed baseline; tolerances in spec §6 are provisional until seen.
    console.log(
      `[parity] headed vs headless mismatch: ${mismatch}/${total} = ${(fraction * 100).toFixed(4)}%`,
    );
    expect(fraction).toBeLessThan(MAX_MISMATCH_FRACTION);
  });

  it("proves the embedded font is live: render differs from a fallback render", async () => {
    if (!harness.interactive) throw new Error("Interactive browser is unavailable");
    const page = await harness.interactive.newPage();
    const query = new URLSearchParams({ project: fixturePath, screen: screenId });
    try {
      await page.goto(`${harness.server.url}/render?${query}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__stageReady === true || window.__renderError);
      expect(await page.evaluate(() => Array.from(document.fonts).some(
        (font) => font.family === "Pacifico" && font.weight === "400" && font.status === "loaded",
      ))).toBe(true);
    } finally {
      await page.close();
    }

    // Keep every non-font input identical so the raster difference cannot be caused by missing
    // neighbouring assets or by mutating the tracked fixture.
    const fallbackRoot = mkdtempSync(resolve(tmpdir(), "parity-fallback-"));
    try {
      cpSync(fixtureRoot, fallbackRoot, { recursive: true });
      const fallbackPath = resolve(fallbackRoot, "app-store-screenshots.json");
      const project = JSON.parse(readFileSync(fallbackPath, "utf8"));
      for (const el of project.layouts[0].screens[0].elements) {
        if (el.type === "text") el.fontFamily = "serif";
      }
      project.fonts = [];
      writeFileSync(fallbackPath, JSON.stringify(project));

      const custom = await harness.headless.renderScreenToPng({
        baseUrl: harness.server.url,
        projectPath: fixturePath,
        layoutId: "default",
        screenId,
        pixelRatio,
      });
      const fallback = await harness.headless.renderScreenToPng({
        baseUrl: harness.server.url,
        projectPath: fallbackPath,
        layoutId: "default",
        screenId,
        pixelRatio,
      });

      const { mismatch } = countMismatch(stripAlpha(custom), stripAlpha(fallback));
      expect(mismatch).toBeGreaterThan(2000);
    } finally {
      rmSync(fallbackRoot, { recursive: true, force: true });
    }
  });
});
