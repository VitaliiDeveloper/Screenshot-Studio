// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/sample/assets");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "font-management-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  const project = JSON.parse(readFileSync(sample, "utf8"));
  const headline = project.screens[0].elements.find((element: { id: string }) => element.id === "headline");
  headline.name = "Font headline";
  writeFileSync(projectFile, JSON.stringify(project));
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  process.env.PROJECT_PATH = projectFile;
  server = await startWebServer(3132);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function project() {
  return JSON.parse(readFileSync(projectFile, "utf8"));
}

describe("font management UI", () => {
  it("uploads, previews, applies, persists, and reloads a font identity", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    await page.getByRole("button", { name: "Font headline", exact: true }).click();
    await page.getByRole("button", { name: "Resources panel", exact: true }).click();
    await page.getByRole("button", { name: "Fonts", exact: true }).click();
    await page.getByLabel("Font file").setInputFiles(resolve(sampleAssets, "fonts/Pacifico-Regular.ttf"));
    await page.getByLabel("Upload font family").fill("Pacifico Alt");
    await page.getByLabel("Upload font weight").fill("700");
    let releaseFontRequest!: () => void;
    let markFontRequested!: () => void;
    const fontRequestGate = new Promise<void>((resolveGate) => { releaseFontRequest = resolveGate; });
    const fontRequested = new Promise<void>((resolveRequest) => { markFontRequested = resolveRequest; });
    await page.route("**/api/asset?*", async (route) => {
      const assetPath = new URL(route.request().url()).searchParams.get("path");
      if (assetPath === "assets/fonts/pacifico-alt-700.ttf") {
        markFontRequested();
        await fontRequestGate;
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Add uploaded font" }).click();

    const row = page.getByTestId("font-row-Pacifico Alt-700");
    await fontRequested;
    expect(await row.count()).toBe(0);
    releaseFontRequest();
    await row.waitFor({ state: "visible" });
    await expect.poll(() => page.evaluate(() => Array.from(document.fonts).some(
      (face) => face.family === "Pacifico Alt" && face.weight === "700" && face.status === "loaded",
    ))).toBe(true);
    expect(await page.evaluate(() => document.fonts.check('700 16px "Pacifico Alt"'))).toBe(true);
    const previewFamily = await row.getByText("The quick brown fox 0123").evaluate(
      (element) => getComputedStyle(element).fontFamily,
    );
    expect(previewFamily).toContain("Pacifico Alt");
    expect(project().fonts).toContainEqual({
      family: "Pacifico Alt", weight: 700, source: "uploaded", path: "assets/fonts/pacifico-alt-700.ttf",
    });

    await row.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => {
      const element = project().screens[0].elements.find((candidate: { id: string }) => candidate.id === "headline");
      return `${element.fontFamily}:${element.weight}`;
    }).toBe("Pacifico Alt:700");

    await page.getByRole("button", { name: "Close font manager", exact: true }).click();
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("canvas");
    await page.getByRole("button", { name: "Font headline", exact: true }).click();
    expect(await page.getByRole("button", { name: "Font", exact: true }).textContent()).toContain("Pacifico Alt · 700");

    await page.close();
  });
});
