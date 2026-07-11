// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { stripAlpha } from "../packages/core/src/export/png.js";
import { startWebServer } from "../packages/cli/src/server.js";
import {
  closeParityRenderHarness,
  startParityRenderHarness,
  type ParityRenderHarness,
} from "./support/parity-render-harness.js";

const MAX_MISMATCH_FRACTION = 0.005;

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceImage = resolve(repoRoot, "fixtures/phase-0-sample/assets/demo-logistics-app.png");
let harness: ParityRenderHarness;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "frame-presets-"));
  mkdirSync(join(directory, "assets"), { recursive: true });
  cpSync(sourceImage, join(directory, "assets", "screen.png"));
  const presets = ["iphone", "android-phone", "tablet", "desktop", "tv", "watch"] as const;
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Frame presets", schemaVersion: 10 }, mode: "isolated",
    platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{
      id: "frames", name: "Frames", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
      artboard: { width: 900, height: 700 }, background: { type: "solid", color: "#E2E8F0" },
      elements: presets.map((deviceType, index) => ({
        id: deviceType, type: "device-frame", deviceType, assetUrl: "assets/screen.png", fit: "cover",
        x: 30 + (index % 3) * 290, y: 30 + Math.floor(index / 3) * 340,
        width: 240, height: index < 2 ? 520 : index === 2 || index === 5 ? 300 : 150,
        rotation: 0, opacity: 1, locked: false, visible: true,
      })),
    }],
  }));
  process.env.PROJECT_PATH = projectPath;
  harness = await startParityRenderHarness(() => startWebServer(), () => chromium.launch());
}, 180_000);

afterAll(async () => {
  await closeParityRenderHarness(harness);
  delete process.env.PROJECT_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("Phase 9 frame preset parity", () => {
  it("matches UI/CLI pixels for all trusted built-in presets", async () => {
    const headless = stripAlpha(await harness.headless.renderScreenToPng({
      baseUrl: harness.server.url, projectPath, screenId: "frames", pixelRatio: 1,
    }));
    const headed = stripAlpha(await harness.headed.renderScreenToPng({
      baseUrl: harness.server.url, projectPath, screenId: "frames", pixelRatio: 1, timeoutMs: 60_000,
    }));
    const expected = PNG.sync.read(headless);
    const actual = PNG.sync.read(headed);
    expect({ width: expected.width, height: expected.height }).toEqual({ width: 900, height: 700 });
    const diff = new PNG({ width: expected.width, height: expected.height });
    const mismatch = pixelmatch(
      expected.data,
      actual.data,
      diff.data,
      expected.width,
      expected.height,
      { threshold: 0.1 },
    );
    expect(mismatch / (expected.width * expected.height)).toBeLessThan(MAX_MISMATCH_FRACTION);
  });
});
