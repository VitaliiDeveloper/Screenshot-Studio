// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Locator } from "playwright";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { stripAlpha } from "../packages/core/src/export/png.js";
import {
  DEVICE_FRAME_IDS,
  DEVICE_FRAME_SPECS,
  type Project,
} from "../packages/core/src/model/index.js";
import { startWebServer } from "../packages/cli/src/server.js";
import {
  closeParityRenderHarness,
  startParityRenderHarness,
  type ParityRenderHarness,
} from "./support/parity-render-harness.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = resolve(repoRoot, "fixtures/sample");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");
const artboard = { width: 1320, height: 2868 };
const magentaAssetUrl = "assets/semantic-magenta.png";
const frameRegions = DEVICE_FRAME_IDS.map((deviceType, index) => ({
  deviceType,
  x: 30 + index * 210,
  y: 1800,
  width: 170,
  height: 170 / DEVICE_FRAME_SPECS[deviceType].aspectRatio,
}));

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface LogicalPoint {
  x: number;
  y: number;
}

interface LogicalRegion extends LogicalPoint {
  width: number;
  height: number;
}

interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

let harness: ParityRenderHarness;
let directory: string;
let projectPath: string;

function backingPoint(raster: Raster, point: LogicalPoint): LogicalPoint {
  return {
    x: Math.max(0, Math.min(raster.width - 1, Math.floor(point.x * raster.width / artboard.width))),
    y: Math.max(0, Math.min(raster.height - 1, Math.floor(point.y * raster.height / artboard.height))),
  };
}

function rgbAt(raster: Raster, point: LogicalPoint): Rgb {
  const backing = backingPoint(raster, point);
  const offset = (backing.y * raster.width + backing.x) * 4;
  return {
    r: raster.data[offset]!,
    g: raster.data[offset + 1]!,
    b: raster.data[offset + 2]!,
  };
}

function expectRgbNear(
  raster: Raster,
  point: LogicalPoint,
  expected: Rgb,
  tolerance: number,
  label: string,
): void {
  const actual = rgbAt(raster, point);
  for (const channel of ["r", "g", "b"] as const) {
    expect(
      Math.abs(actual[channel] - expected[channel]),
      `${label}: ${channel.toUpperCase()} channel at (${point.x}, ${point.y}); actual ${JSON.stringify(actual)}`,
    ).toBeLessThanOrEqual(tolerance);
  }
}

function countLogicalPixels(
  raster: Raster,
  region: LogicalRegion,
  predicate: (rgb: Rgb) => boolean,
): number {
  const start = backingPoint(raster, region);
  const end = backingPoint(raster, {
    x: region.x + region.width,
    y: region.y + region.height,
  });
  let count = 0;
  for (let y = start.y; y <= end.y; y += 1) {
    for (let x = start.x; x <= end.x; x += 1) {
      const offset = (y * raster.width + x) * 4;
      if (predicate({
        r: raster.data[offset]!,
        g: raster.data[offset + 1]!,
        b: raster.data[offset + 2]!,
      })) count += 1;
    }
  }
  return count;
}

function expectHeroSemantics(raster: Raster, surface: string): void {
  expectRgbNear(raster, { x: 20, y: 20 }, { r: 255, g: 0, b: 0 }, 12, `${surface} red gradient edge`);
  expectRgbNear(raster, { x: 1300, y: 20 }, { r: 0, g: 0, b: 255 }, 12, `${surface} blue gradient edge`);
  // Konva's ellipse-local X origin is its centre, so the shared 0° gradient begins green there;
  // the separate right-interior probe proves it progresses toward yellow instead of staying solid.
  expectRgbNear(raster, { x: 250, y: 1050 }, { r: 0, g: 255, b: 0 }, 20, `${surface} ellipse green midpoint`);
  expectRgbNear(raster, { x: 370, y: 1050 }, { r: 102, g: 255, b: 0 }, 24, `${surface} ellipse yellow progression`);
  expectRgbNear(raster, { x: 250, y: 905 }, { r: 255, g: 255, b: 255 }, 24, `${surface} ellipse stroke`);

  const cyanShadowPixels = countLogicalPixels(
    raster,
    { x: 500, y: 850, width: 730, height: 270 },
    ({ r, g, b }) => r < 100 && g > 180 && b > 180,
  );
  expect(cyanShadowPixels, `${surface} cyan text-shadow pixels`).toBeGreaterThan(20);

  for (const frame of frameRegions) {
    expectRgbNear(
      raster,
      { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 },
      { r: 255, g: 0, b: 255 },
      20,
      `${surface} ${frame.deviceType} frame content`,
    );
    const bezel = rgbAt(raster, { x: frame.x + 3, y: frame.y + frame.height / 2 });
    expect(
      bezel.r < 60 && bezel.g < 60 && bezel.b < 60,
      `${surface} ${frame.deviceType} dark bezel; actual ${JSON.stringify(bezel)}`,
    ).toBe(true);
  }
}

function expectImageBackground(raster: Raster, surface: string): void {
  expectRgbNear(
    raster,
    { x: 660, y: 1434 },
    { r: 255, g: 0, b: 255 },
    12,
    `${surface} image background`,
  );
}

async function canvasRaster(canvas: Locator): Promise<PNG> {
  const dataUrl = await canvas.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Expected an editor canvas");
    return element.toDataURL("image/png");
  });
  const separator = dataUrl.indexOf(",");
  if (separator < 0) throw new Error("Editor canvas did not produce a PNG data URL");
  return PNG.sync.read(Buffer.from(dataUrl.slice(separator + 1), "base64"));
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "styling-parity-"));
  cpSync(fixtureRoot, directory, { recursive: true });
  projectPath = join(directory, "app-store-screenshots.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8")) as Project;
  const stylingScreen = project.screens.find((screen) => screen.id === "hero")!;
  const imageBackgroundScreen = project.screens.find((screen) => screen.id === "save-fast")!;

  const magenta = new PNG({ width: 8, height: 8 });
  for (let offset = 0; offset < magenta.data.length; offset += 4) {
    magenta.data[offset] = 255;
    magenta.data[offset + 1] = 0;
    magenta.data[offset + 2] = 255;
    magenta.data[offset + 3] = 255;
  }
  writeFileSync(join(directory, magentaAssetUrl), PNG.sync.write(magenta));

  stylingScreen.background = {
    type: "linear-gradient", from: "#FF0000", to: "#0000FF", angle: 0,
  };
  stylingScreen.elements = [
    {
      id: "semantic-ellipse", type: "shape", kind: "ellipse",
      x: 100, y: 900, width: 300, height: 300,
      rotation: 0, opacity: 1, locked: false, visible: true,
      fill: "#00FF00",
      gradient: { from: "#00FF00", to: "#FFFF00", angle: 0 },
      stroke: { color: "#FFFFFF", width: 24 },
      radius: 0,
    },
    {
      id: "semantic-shadow", type: "text", content: "SHADOW",
      x: 500, y: 850, width: 700, height: 240,
      rotation: 0, opacity: 1, locked: false, visible: true,
      fontFamily: "Pacifico", size: 140, weight: 400,
      lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
      shadow: { color: "#00FFFF", blur: 0, offsetX: 30, offsetY: 30, opacity: 1 },
    },
    ...frameRegions.map((frame) => ({
      id: `semantic-${frame.deviceType}`,
      type: "device-frame" as const,
      deviceType: frame.deviceType,
      assetUrl: magentaAssetUrl,
      fit: "cover" as const,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
    })),
  ];
  imageBackgroundScreen.background = {
    type: "image", assetUrl: magentaAssetUrl, fit: "cover", color: "#000000",
  };
  imageBackgroundScreen.elements = [];
  project.screens = [stylingScreen, imageBackgroundScreen];
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
  harness = await startParityRenderHarness(
    () => startWebServer(undefined, { projectPath, storeSpecsPath }),
    () => chromium.launch(),
  );
}, 180_000);

afterAll(async () => {
  await closeParityRenderHarness(harness);
  rmSync(directory, { recursive: true, force: true });
});

describe("Expanded renderer styling parity", () => {
  it("matches headed/headless pixels and preserves styling semantics in static and editor renders", async () => {
    const staticRasters = new Map<string, PNG>();
    for (const screenId of ["hero", "save-fast"]) {
      const headless = stripAlpha(await harness.headless.renderScreenToPng({
        baseUrl: harness.server.url, projectPath, screenId, pixelRatio: 1,
      }));
      const headed = stripAlpha(await harness.headed.renderScreenToPng({
        baseUrl: harness.server.url, projectPath, screenId, pixelRatio: 1, timeoutMs: 60_000,
      }));
      const expected = PNG.sync.read(headless);
      const actual = PNG.sync.read(headed);
      expect({ width: expected.width, height: expected.height }).toEqual(artboard);
      expect({ width: actual.width, height: actual.height }).toEqual(artboard);
      const diff = new PNG({ width: expected.width, height: expected.height });
      const mismatch = pixelmatch(
        expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: 0.1 },
      );
      expect(mismatch / (expected.width * expected.height)).toBeLessThan(0.005);
      staticRasters.set(screenId, expected);
    }

    expectHeroSemantics(staticRasters.get("hero")!, "static render");
    expectImageBackground(staticRasters.get("save-fast")!, "static render");

    if (!harness.interactive) throw new Error("Interactive browser is unavailable");
    const page = await harness.interactive.newPage({
      viewport: { width: 3600, height: 3200 },
      reducedMotion: "reduce",
    });
    try {
      await page.goto(`${harness.server.url}/editor`, { waitUntil: "load" });
      const viewport = page.getByTestId("canvas-viewport");
      await expect.poll(
        () => viewport.getAttribute("data-initial-reveal"),
        { timeout: 20_000 },
      ).toBe("idle");

      const heroCanvas = page.locator('[data-artboard-screen-id="hero"] canvas').first();
      const imageBackgroundCanvas = page.locator('[data-artboard-screen-id="save-fast"] canvas').first();
      await heroCanvas.waitFor({ state: "attached" });
      await imageBackgroundCanvas.waitFor({ state: "attached" });
      const [heroEditorRaster, imageBackgroundEditorRaster] = await Promise.all([
        canvasRaster(heroCanvas),
        canvasRaster(imageBackgroundCanvas),
      ]);
      expectHeroSemantics(heroEditorRaster, "editor canvas");
      expectImageBackground(imageBackgroundEditorRaster, "editor canvas");
    } finally {
      await page.close();
    }
  });
});
