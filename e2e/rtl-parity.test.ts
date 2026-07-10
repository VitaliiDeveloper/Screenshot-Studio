import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";
import { renderScreenToPng } from "../packages/cli/src/render-driver.js";
import { inspectPng, stripAlpha } from "../packages/core/src/export/png.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/phase-4-rtl/app-store-screenshots.json");
const pixelRatio = 2;
const target = { width: 1320, height: 2868 };
const MAX_MISMATCH_FRACTION = 0.001;

let server: RunningServer;

beforeAll(async () => {
  server = await startWebServer(3131);
}, 180_000);

afterAll(async () => {
  await server?.stop();
});

function countMismatch(a: Buffer, b: Buffer): number {
  const first = PNG.sync.read(a);
  const second = PNG.sync.read(b);
  expect(first.width).toBe(second.width);
  expect(first.height).toBe(second.height);
  const diff = new PNG({ width: first.width, height: first.height });
  return pixelmatch(first.data, second.data, diff.data, first.width, first.height, {
    threshold: 0.1,
  });
}

describe("Phase 4 RTL render parity", () => {
  it("renders explicit RTL identically in headed and headless Chromium", async () => {
    const headed = stripAlpha(await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId: "arabic-rtl",
      pixelRatio,
      headless: false,
    }));
    const headless = stripAlpha(await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId: "arabic-rtl",
      pixelRatio,
      headless: true,
    }));

    for (const png of [headed, headless]) {
      expect(inspectPng(png)).toMatchObject({ ...target, hasAlpha: false });
    }

    const mismatch = countMismatch(headed, headless);
    expect(mismatch / (target.width * target.height)).toBeLessThan(MAX_MISMATCH_FRACTION);
  });

  it("proves the stored bidi direction changes mixed Arabic/numeral layout", async () => {
    const rtl = stripAlpha(await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId: "arabic-rtl",
      pixelRatio,
      headless: true,
    }));
    const ltr = stripAlpha(await renderScreenToPng({
      baseUrl: server.url,
      projectPath: fixturePath,
      screenId: "arabic-ltr",
      pixelRatio,
      headless: true,
    }));

    expect(countMismatch(rtl, ltr)).toBeGreaterThan(500);
  });
});
