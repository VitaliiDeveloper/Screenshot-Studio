// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startWebServer } from "../packages/cli/src/server.js";
import { stripAlpha } from "../packages/core/src/export/png.js";
import {
  closeParityRenderHarness,
  startParityRenderHarness,
  type ParityRenderHarness,
} from "./support/parity-render-harness.js";

/**
 * Slice 3 gate: proves the device-frame Group is parity-safe. (1) headed vs headless renders of a
 * screen with a device-frame match within tolerance; (2) the framed image's pixels are provably
 * present (red at the slot centre) — a Group that failed to composit the image would fail this;
 * (3) the image is live — a missing asset (black slot placeholder) differs by many pixels.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDir = resolve(repoRoot, "fixtures/regressions/device-frame-parity");
const fixturePath = resolve(fixtureDir, "app-store-screenshots.json");
const screenId = "framed";
const pixelRatio = 2;
const target = { width: 1320, height: 2868 };
const PER_PIXEL_THRESHOLD = 0.1;
const MAX_MISMATCH_FRACTION = 0.001;

let harness: ParityRenderHarness;

beforeAll(async () => {
  harness = await startParityRenderHarness(() => startWebServer());
}, 180_000);

afterAll(async () => {
  await closeParityRenderHarness(harness);
});

function mismatch(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  expect(pa.width).toBe(pb.width);
  expect(pa.height).toBe(pb.height);
  const diff = new PNG({ width: pa.width, height: pa.height });
  return pixelmatch(pa.data, pb.data, diff.data, pa.width, pa.height, { threshold: PER_PIXEL_THRESHOLD });
}

describe("device-frame parity", () => {
  it("headed and headless match, and the framed image is present (red at slot centre)", async () => {
    const headed = stripAlpha(await harness.headed.renderScreenToPng({
      baseUrl: harness.server.url, projectPath: fixturePath, screenId, pixelRatio, timeoutMs: 60_000,
    }));
    const headless = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url, projectPath: fixturePath, screenId, pixelRatio,
    }));

    const px = PNG.sync.read(headless);
    expect(px.width).toBe(target.width);
    expect(px.height).toBe(target.height);

    // Positive content: the asset (red) must actually be painted at the slot centre — not the black
    // slot background. This is what a broken Group composit fails; the diff check cannot catch it.
    const i = (1400 * px.width + 660) * 4;
    expect(px.data[i]).toBeGreaterThan(150);     // R high
    expect(px.data[i + 1]).toBeLessThan(100);    // G low
    expect(px.data[i + 2]).toBeLessThan(100);    // B low

    const fraction = mismatch(headed, headless) / (target.width * target.height);
    console.log(`[frame-parity] headed vs headless: ${(fraction * 100).toFixed(4)}%`);
    expect(fraction).toBeLessThan(MAX_MISMATCH_FRACTION);
  });

  it("proves the framed image is live: render differs from a missing-asset placeholder", async () => {
    const project = JSON.parse(readFileSync(fixturePath, "utf8"));
    project.screens[0].elements[0].assetUrl = "assets/does-not-exist.png";
    const temporaryRoot = mkdtempSync(resolve(tmpdir(), "device-frame-parity-missing-"));
    const temporaryProject = resolve(temporaryRoot, "app-store-screenshots.json");
    try {
      cpSync(resolve(fixtureDir, "assets"), resolve(temporaryRoot, "assets"), { recursive: true });
      writeFileSync(temporaryProject, JSON.stringify(project));

      const present = stripAlpha(await harness.headless.renderScreenToPng({
        baseUrl: harness.server.url, projectPath: fixturePath, screenId, pixelRatio,
      }));
      const placeholder = stripAlpha(await harness.headless.renderScreenToPng({
        baseUrl: harness.server.url, projectPath: temporaryProject, screenId, pixelRatio,
      }));
      expect(mismatch(present, placeholder)).toBeGreaterThan(2000);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }

    expect(existsSync(temporaryRoot)).toBe(false);
    expect(existsSync(resolve(fixtureDir, "_missing.json"))).toBe(false);
  });
});
