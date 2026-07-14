// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = resolve(repoRoot, "fixtures/sample");
let harness: ParityRenderHarness;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "styling-parity-"));
  cpSync(fixtureRoot, directory, { recursive: true });
  projectPath = join(directory, "app-store-screenshots.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8")) as {
    screens: Array<{ background: Record<string, unknown>; elements: Array<Record<string, unknown>> }>;
  };
  project.screens[0]!.background = {
    type: "linear-gradient", from: "#0B1020", to: "#172554", angle: 35,
  };
  const shape = project.screens[0]!.elements.find((element) => element.type === "shape")!;
  Object.assign(shape, {
    kind: "ellipse",
    gradient: { from: "#FF0066", to: "#00CCFF", angle: 45 },
    stroke: { color: "#FFFFFF", width: 8 },
  });
  const text = project.screens[0]!.elements.find((element) => element.type === "text")!;
  text.shadow = { color: "#000000", blur: 12, offsetX: 4, offsetY: 8, opacity: 0.6 };
  const presets = ["iphone", "android-phone", "tablet", "desktop", "tv", "watch"] as const;
  project.screens[0]!.elements.push(...presets.map((deviceType, index) => ({
    id: `phase9-${deviceType}`, type: "device-frame", deviceType,
    assetUrl: "assets/demo-logistics-app.png", fit: "cover",
    x: 15 + index * 105, y: 1190, width: 90,
    height: deviceType === "iphone" || deviceType === "android-phone" ? 195
      : deviceType === "tablet" || deviceType === "watch" ? 120 : 56,
    rotation: 0, opacity: 1, locked: false, visible: true,
  })));
  project.screens[1]!.background = {
    type: "image", assetUrl: "assets/demo-logistics-app.png", fit: "cover", color: "#081426",
  };
  writeFileSync(projectPath, JSON.stringify(project));
  process.env.PROJECT_PATH = projectPath;
  harness = await startParityRenderHarness(() => startWebServer(), () => chromium.launch());
}, 180_000);

afterAll(async () => {
  await closeParityRenderHarness(harness);
  delete process.env.PROJECT_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("Phase 9 expanded renderer parity", () => {
  it("matches UI/CLI pixels for backgrounds, styling, and every frame preset", async () => {
    for (const screenId of ["hero", "save-fast"]) {
      const headless = stripAlpha(await harness.headless.renderScreenToPng({
        baseUrl: harness.server.url, projectPath, screenId, pixelRatio: 1,
      }));
      const headed = stripAlpha(await harness.headed.renderScreenToPng({
        baseUrl: harness.server.url, projectPath, screenId, pixelRatio: 1, timeoutMs: 60_000,
      }));
      const expected = PNG.sync.read(headless);
      const actual = PNG.sync.read(headed);
      expect({ width: expected.width, height: expected.height }).toEqual({ width: 660, height: 1434 });
      const diff = new PNG({ width: expected.width, height: expected.height });
      const mismatch = pixelmatch(
        expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: 0.1 },
      );
      expect(mismatch / (expected.width * expected.height)).toBeLessThan(0.005);
    }
  });
});
