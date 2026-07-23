// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Page } from "playwright";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startWebServer } from "@screenshot-studio/cli/server";
import { stripAlpha } from "@screenshot-studio/core/export";
import {
  closeParityRenderHarness,
  startParityRenderHarness,
  type ParityRenderHarness,
} from "./support/parity-render-harness.js";

/**
 * Proves the shared device-frame recipe Group is parity-safe. (1) the real EditorStage canvas and
 * the CLI's browser /render output match within tolerance for a representative semantic matrix;
 * (2) each framed image's pixels are provably present (red at the slot centre) — a Group that failed
 * to composite the image would fail this; (3) the image is live — a missing asset (black slot
 * placeholder) differs by many pixels.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDir = resolve(repoRoot, "fixtures/regressions/device-frame-parity");
const fixturePath = resolve(fixtureDir, "app-store-screenshots.json");
const recipeScreenIds = [
  "framed",
  "phone-outline",
  "tablet-rounded-light",
  "browser-dark",
  "laptop-silver",
  "watch-square",
  "frameless-phone",
] as const;
const pixelRatio = 1;
const target = { width: 660, height: 1434 };
const PER_PIXEL_THRESHOLD = 0.1;
const MAX_MISMATCH_FRACTION = 0.001;

let harness: ParityRenderHarness;

beforeAll(async () => {
  process.env.PROJECT_PATH = fixturePath;
  harness = await startParityRenderHarness(
    () => startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") }),
    () => chromium.launch({ headless: false }),
  );
}, 180_000);

afterAll(async () => {
  await closeParityRenderHarness(harness);
  delete process.env.PROJECT_PATH;
});

function mismatch(a: Buffer, b: Buffer): number {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  expect(pa.width).toBe(pb.width);
  expect(pa.height).toBe(pb.height);
  const diff = new PNG({ width: pa.width, height: pa.height });
  return pixelmatch(pa.data, pb.data, diff.data, pa.width, pa.height, { threshold: PER_PIXEL_THRESHOLD });
}

async function editorCanvasPng(page: Page, screenId: string): Promise<Buffer> {
  const canvas = page.locator(`[data-artboard-screen-id="${screenId}"] canvas`).first();
  await canvas.waitFor({ state: "attached" });
  await expect.poll(() => canvas.evaluate((node: HTMLCanvasElement) => ({
    width: node.width,
    height: node.height,
  }))).toEqual(target);
  await expect.poll(() => canvas.evaluate((node: HTMLCanvasElement) => {
    const pixel = node.getContext("2d")!.getImageData(node.width / 2, node.height / 2, 1, 1).data;
    return pixel[0]! > 150 && pixel[1]! < 100 && pixel[2]! < 100;
  })).toBe(true);
  const dataUrl = await canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL("image/png"));
  return stripAlpha(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
}

describe("device-frame parity", () => {
  it("matches the real editor canvas and CLI render for every representative recipe", async () => {
    if (!harness.interactive) throw new Error("Interactive browser is unavailable");
    const page = await harness.interactive.newPage({
      viewport: { width: 1800, height: 1800 },
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${harness.server.url}/editor`, { waitUntil: "load" });
      const viewport = page.getByTestId("canvas-viewport");
      await expect.poll(
        () => viewport.getAttribute("data-initial-reveal"),
        { timeout: 20_000 },
      ).toBe("idle");
      await page.getByLabel("Zoom controls").getByRole("button", { name: /%$/ }).click();

      for (const screenId of recipeScreenIds) {
        const editor = await editorCanvasPng(page, screenId);
        const cli = stripAlpha(await harness.headless.renderScreenToPng({
          baseUrl: harness.server.url, projectPath: fixturePath, layoutId: "default", screenId, pixelRatio,
        }));

        const px = PNG.sync.read(cli);
        expect({ width: px.width, height: px.height }).toEqual(target);

        // Every fixture centers the red source image at the artboard center. This positive assertion
        // catches a shared-path failure that an editor/CLI diff alone cannot detect.
        const i = (717 * px.width + 330) * 4;
        expect(px.data[i]).toBeGreaterThan(150);
        expect(px.data[i + 1]).toBeLessThan(100);
        expect(px.data[i + 2]).toBeLessThan(100);

        const fraction = mismatch(editor, cli) / (target.width * target.height);
        console.log(`[frame-parity] ${screenId}: ${(fraction * 100).toFixed(4)}%`);
        expect(fraction).toBeLessThan(MAX_MISMATCH_FRACTION);
      }
    } finally {
      await page.close();
    }
  });

  it("proves content blur is active and the framed image is live", async () => {
    const project = JSON.parse(readFileSync(fixturePath, "utf8"));
    const temporaryRoot = mkdtempSync(resolve(tmpdir(), "device-frame-parity-missing-"));
    const temporaryProject = resolve(temporaryRoot, "app-store-screenshots.json");
    try {
      cpSync(resolve(fixtureDir, "assets"), resolve(temporaryRoot, "assets"), { recursive: true });
      delete project.layouts[0].screens[0].elements[0].blur;
      writeFileSync(temporaryProject, JSON.stringify(project));

      const blurred = stripAlpha(await harness.headless.renderScreenToPng({
        baseUrl: harness.server.url, projectPath: fixturePath, layoutId: "default", screenId: "framed", pixelRatio,
      }));
      const sharp = stripAlpha(await harness.headless.renderScreenToPng({
        baseUrl: harness.server.url, projectPath: temporaryProject, layoutId: "default", screenId: "framed", pixelRatio,
      }));
      expect(mismatch(blurred, sharp)).toBeGreaterThan(1000);

      delete project.layouts[0].screens[0].elements[0].assetUrl;
      writeFileSync(temporaryProject, JSON.stringify(project));
      const placeholder = stripAlpha(await harness.headless.renderScreenToPng({
        baseUrl: harness.server.url, projectPath: temporaryProject, layoutId: "default", screenId: "framed", pixelRatio,
      }));
      expect(mismatch(blurred, placeholder)).toBeGreaterThan(2000);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }

    expect(existsSync(temporaryRoot)).toBe(false);
    expect(existsSync(resolve(fixtureDir, "_missing.json"))).toBe(false);
  });
});
