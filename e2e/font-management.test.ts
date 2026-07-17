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
  const headline = project.layouts[0].screens[0].elements.find((element: { id: string }) => element.id === "headline");
  headline.name = "Font headline";
  writeFileSync(projectFile, JSON.stringify(project));
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  server = await startWebServer(undefined, {
    projectPath: projectFile,
    storeSpecsPath: resolve(repoRoot, "store-specs.json"),
  });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

function project() {
  return JSON.parse(readFileSync(projectFile, "utf8"));
}

async function waitForEditorCanvas(page: import("playwright").Page): Promise<void> {
  try {
    await page.waitForSelector("canvas");
  } catch (error) {
    const body = await page.locator("body").innerText().catch(() => "<body unavailable>");
    throw new Error(`Editor canvas did not become ready:\n${body}`, { cause: error });
  }
}

describe("font management UI", () => {
  it("surfaces a missing project font and recovers it through the visible retry", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    let fontRequests = 0;
    await page.route("**/api/asset?*", async (route) => {
      const assetPath = new URL(route.request().url()).searchParams.get("path");
      if (assetPath === "assets/fonts/Pacifico-Regular.ttf" && fontRequests++ === 0) {
        await route.fulfill({ status: 404, body: "font temporarily unavailable" });
        return;
      }
      await route.continue();
    });

    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await waitForEditorCanvas(page);
    const warning = page.getByRole("alert").filter({ hasText: "Some project fonts could not be loaded" });
    await warning.waitFor({ state: "visible" });
    expect(await warning.textContent()).toContain("Pacifico 400");

    await warning.getByRole("button", { name: "Retry project fonts" }).click();
    await warning.waitFor({ state: "hidden" });
    await expect.poll(() => page.evaluate(() => Array.from(document.fonts).some(
      (font) => font.family === "Pacifico" && font.weight === "400" && font.status === "loaded",
    ))).toBe(true);
    await page.close();
  });

  it("uploads, previews, applies, persists, and reloads a font identity", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await waitForEditorCanvas(page);

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
    await row.waitFor({ state: "visible" });
    expect(await row.getByRole("button", { name: "Remove" }).isDisabled()).toBe(true);
    releaseFontRequest();
    await expect.poll(() => page.evaluate(() => Array.from(document.fonts).some(
      (face) => face.family === "Pacifico Alt" && face.weight === "700" && face.status === "loaded",
    ))).toBe(true);
    expect(await row.getByRole("button", { name: "Remove" }).isEnabled()).toBe(true);
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
      const element = project().layouts[0].screens[0].elements.find((candidate: { id: string }) => candidate.id === "headline");
      return `${element.fontFamily}:${element.weight}`;
    }).toBe("Pacifico Alt:700");

    await page.getByRole("button", { name: "Close font manager", exact: true }).click();
    await page.reload({ waitUntil: "load" });
    await waitForEditorCanvas(page);
    await page.getByRole("button", { name: "Font headline", exact: true }).click();
    expect(await page.getByRole("button", { name: "Font", exact: true }).textContent()).toContain("Pacifico Alt · 700");

    await page.getByRole("button", { name: "Resources panel", exact: true }).click();
    await page.getByRole("button", { name: "Fonts", exact: true }).click();
    await row.getByRole("button", { name: "Remove" }).click();
    const inUseError = page.getByRole("alert").filter({ hasText: /used by .* text element/i });
    await inUseError.waitFor({ state: "visible" });
    expect(project().fonts).toContainEqual({
      family: "Pacifico Alt", weight: 700, source: "uploaded", path: "assets/fonts/pacifico-alt-700.ttf",
    });

    const original = page.getByTestId("font-row-Pacifico-400");
    await original.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => {
      const element = project().layouts[0].screens[0].elements.find((candidate: { id: string }) => candidate.id === "headline");
      return `${element.fontFamily}:${element.weight}`;
    }).toBe("Pacifico:400");
    await row.getByRole("button", { name: "Remove" }).click();
    await row.waitFor({ state: "detached" });
    expect(project().fonts.some((font: { family: string; weight: number }) =>
      font.family === "Pacifico Alt" && font.weight === 700
    )).toBe(false);

    await page.close();
  });
});
