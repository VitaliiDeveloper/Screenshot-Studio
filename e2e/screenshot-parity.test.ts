import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";
import { renderScreenToPng } from "../packages/cli/src/render-driver.js";
import { stripAlpha } from "../packages/core/src/export/png.js";

/**
 * Slice 2 gate: proves asset loading is parity-safe. (1) headed vs headless renders of a screen
 * with a screenshot match within tolerance; (2) the image's pixels are provably present (red at the
 * box centre) — a blank render would fail this; (3) the image is live — a missing asset (grey
 * placeholder) differs by many pixels. Holds only if the readiness gate waits for image decode.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDir = resolve(repoRoot, "fixtures/slice-2-screenshot");
const fixturePath = resolve(fixtureDir, "app-store-screenshots.json");
const tmpDir = resolve(repoRoot, "e2e/.tmp");
const screenId = "shot";
const pixelRatio = 2;
const target = { width: 1320, height: 2868 };
const PER_PIXEL_THRESHOLD = 0.1;
const MAX_MISMATCH_FRACTION = 0.001;

let server: RunningServer;

beforeAll(async () => {
  mkdirSync(tmpDir, { recursive: true });
  server = await startWebServer(3125);
}, 180_000);

afterAll(async () => {
  await server?.stop();
});

function mismatch(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  expect(pa.width).toBe(pb.width);
  expect(pa.height).toBe(pb.height);
  const diff = new PNG({ width: pa.width, height: pa.height });
  return pixelmatch(pa.data, pb.data, diff.data, pa.width, pa.height, { threshold: PER_PIXEL_THRESHOLD });
}

describe("Slice 2 screenshot parity", () => {
  it("headed and headless match, and the image pixels are present (red at box centre)", async () => {
    const headed = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath: fixturePath, screenId, pixelRatio, headless: false,
    }));
    const headless = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath: fixturePath, screenId, pixelRatio, headless: true,
    }));

    const px = PNG.sync.read(headless);
    expect(px.width).toBe(target.width);
    expect(px.height).toBe(target.height);

    // Positive content: the asset (red) must actually be painted at the box centre — not the dark
    // background. This is what a blank/broken render fails; the diff check below cannot catch it.
    const i = (1400 * px.width + 660) * 4;
    expect(px.data[i]).toBeGreaterThan(150);     // R high
    expect(px.data[i + 1]).toBeLessThan(100);    // G low
    expect(px.data[i + 2]).toBeLessThan(100);    // B low

    const fraction = mismatch(headed, headless) / (target.width * target.height);
    console.log(`[shot-parity] headed vs headless: ${(fraction * 100).toFixed(4)}%`);
    expect(fraction).toBeLessThan(MAX_MISMATCH_FRACTION);
  });

  it("proves the image is live: render differs from a missing-asset placeholder", async () => {
    const project = JSON.parse(readFileSync(fixturePath, "utf8"));
    project.screens[0].elements[0].assetUrl = "assets/does-not-exist.png";
    // Written INTO the fixture dir so the asset route's base (dirname of the project) still points
    // at the fixture's assets/ — the point is that does-not-exist.png 404s → grey placeholder.
    const missingInDir = resolve(fixtureDir, "_missing.json");
    writeFileSync(missingInDir, JSON.stringify(project));

    const present = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath: fixturePath, screenId, pixelRatio, headless: true,
    }));
    const placeholder = stripAlpha(await renderScreenToPng({
      baseUrl: server.url, projectPath: missingInDir, screenId, pixelRatio, headless: true,
    }));
    expect(mismatch(present, placeholder)).toBeGreaterThan(2000);
  });
});
