import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";
import { renderScreenToPng } from "../packages/cli/src/render-driver.js";
import { stripAlpha, inspectPng } from "../packages/core/src/export/png.js";

/**
 * Phase 0 exit gate (docs/roadmap.md §4). Proves, on the hardest parity case (embedded custom
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
const fixturePath = resolve(repoRoot, "fixtures/phase-0-sample/app-store-screenshots.json");
const tmpDir = resolve(repoRoot, "e2e/.tmp");
const screenId = "hero";
const pixelRatio = 2; // 660×1434 artboard → 1320×2868 lead size
const target = { width: 1320, height: 2868 };

// Tolerances (spec §6): starting values, tuned once real diffs are observed.
const PER_PIXEL_THRESHOLD = 0.1;
const MAX_MISMATCH_FRACTION = 0.001; // 0.1% of pixels

let server: RunningServer;

beforeAll(async () => {
  mkdirSync(tmpDir, { recursive: true });
  server = await startWebServer(3123);
}, 180_000);

afterAll(async () => {
  await server?.stop();
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
    const headedRaw = await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId,
      pixelRatio,
      headless: false,
    });
    const headlessRaw = await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId,
      pixelRatio,
      headless: true,
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
    // Same project, but the text element points at a generic family with no embedded font,
    // forcing a system fallback. If the custom font had silently failed, the main render would
    // ALSO be a fallback and these would match — so a large diff is the positive proof.
    const project = JSON.parse(readFileSync(fixturePath, "utf8"));
    for (const el of project.screens[0].elements) {
      if (el.type === "text") el.fontFamily = "serif";
    }
    project.fonts = [];
    const fallbackPath = resolve(tmpDir, "fallback-project.json");
    writeFileSync(fallbackPath, JSON.stringify(project));

    const custom = await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId,
      pixelRatio,
      headless: true,
    });
    const fallback = await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fallbackPath,
      screenId,
      pixelRatio,
      headless: true,
    });

    const { mismatch } = countMismatch(stripAlpha(custom), stripAlpha(fallback));
    // A distinct script font vs serif over a 120px headline differs by many thousands of pixels.
    expect(mismatch).toBeGreaterThan(2000);
  });
});
