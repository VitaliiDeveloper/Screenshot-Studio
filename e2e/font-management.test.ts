// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/sample/assets");
const arabicFixture = resolve(repoRoot, "fixtures/regressions/rtl-parity/assets/fonts/noto-sans-arabic-700.ttf");
const studioSansFixture = resolve(repoRoot, "apps/web/public/fonts/screenshot-studio-sans-regular-v1.ttf");
const SYSTEM_FONT_ROOTS_ENV = "SCREENSHOT_STUDIO_SYSTEM_FONT_ROOTS";

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;
let installedDir: string;
const originalSystemFontRoots = process.env[SYSTEM_FONT_ROOTS_ENV];

/** Sets the OS/2 fsType to "Restricted License embedding" on a copy of a repo font. */
function restrictedCopy(source: string, target: string): void {
  const bytes = readFileSync(source);
  const tableCount = bytes.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const entry = 12 + index * 16;
    if (bytes.toString("ascii", entry, entry + 4) === "OS/2") {
      bytes.writeUInt16BE(0x0002, bytes.readUInt32BE(entry + 8) + 8);
      writeFileSync(target, bytes);
      return;
    }
  }
  throw new Error("fixture has no OS/2 table");
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "font-management-e2e-"));
  installedDir = mkdtempSync(join(tmpdir(), "installed-fonts-e2e-"));
  mkdirSync(join(installedDir, "user"));
  mkdirSync(join(installedDir, "system"));
  copyFileSync(resolve(sampleAssets, "fonts/Pacifico-Regular.ttf"), join(installedDir, "user", "Pacifico-Regular.ttf"));
  copyFileSync(arabicFixture, join(installedDir, "system", "noto-sans-arabic-700.ttf"));
  restrictedCopy(studioSansFixture, join(installedDir, "system", "locked-sans.ttf"));
  process.env[SYSTEM_FONT_ROOTS_ENV] = JSON.stringify([
    { dir: join(installedDir, "user"), source: "user" },
    { dir: join(installedDir, "system"), source: "system" },
  ]);
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
  if (originalSystemFontRoots === undefined) delete process.env[SYSTEM_FONT_ROOTS_ENV];
  else process.env[SYSTEM_FONT_ROOTS_ENV] = originalSystemFontRoots;
  rmSync(dir, { recursive: true, force: true });
  rmSync(installedDir, { recursive: true, force: true });
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

    const fontManager = page.getByRole("dialog", { name: "Font manager" });
    await page.getByRole("button", { name: "Close font manager", exact: true }).click();
    await fontManager.waitFor({ state: "hidden" });
    await page.reload({ waitUntil: "load" });
    await waitForEditorCanvas(page);
    await page.getByRole("heading", { name: "Layers", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Font headline", exact: true }).click();
    expect(await page.getByRole("button", { name: "Font", exact: true }).textContent()).toContain("Pacifico Alt · 700");

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

  it("imports an installed font after previewing it and renders it from the project copy", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    const assetRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/asset?")) assetRequests.push(new URL(request.url()).searchParams.get("path") ?? "");
    });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await waitForEditorCanvas(page);
    await page.getByRole("button", { name: "Fonts", exact: true }).click();
    await page.getByRole("button", { name: "Import from system" }).click();

    const search = page.getByLabel("Search installed fonts");
    await search.waitFor({ state: "visible" });
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Search installed fonts");
    const families = page.getByTestId("system-font-families");
    const family = (name: string) => families.getByRole("button").filter({ has: page.getByText(name, { exact: true }) });

    await search.fill("noto");
    await expect.poll(() => families.getByRole("button").count()).toBe(2);
    await search.fill("zzz-no-such-font");
    expect(await families.getByRole("button").count()).toBe(0);
    await search.fill("noto");

    await family("Noto Sans").click();
    const locked = page.getByTestId("system-font-face-400");
    expect(await locked.getByRole("checkbox").isDisabled()).toBe(true);
    expect(await locked.textContent()).toContain("Restricted License embedding");

    await search.fill("pacifico");
    await family("Pacifico").click();
    const duplicate = page.getByTestId("system-font-face-400");
    expect(await duplicate.getByRole("checkbox").isDisabled()).toBe(true);
    expect(await duplicate.textContent()).toContain("Already in the project");

    await search.fill("arabic");
    await family("Noto Sans Arabic").click();
    expect(await page.getByRole("status").filter({ hasText: "responsible for checking" }).count()).toBe(1);
    const preview = page.getByTestId("system-font-preview-700");
    await preview.waitFor({ state: "visible" });
    expect(await preview.locator("p").first().evaluate((element) => getComputedStyle(element).fontFamily))
      .toContain("__system-preview-");
    expect(await page.evaluate(() => Array.from(document.fonts).some((face) => face.family === "Noto Sans Arabic"))).toBe(false);

    const importButton = page.getByRole("button", { name: /^Import/ }).last();
    expect(await importButton.isDisabled()).toBe(true);
    await page.getByTestId("system-font-face-700").getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    expect(await importButton.textContent()).toBe("Import 1 weight");
    await importButton.click();

    await page.getByRole("status").filter({ hasText: "Imported Noto Sans Arabic 700." }).waitFor({ state: "visible" });
    expect(project().fonts).toContainEqual({
      family: "Noto Sans Arabic", weight: 700, source: "uploaded", path: "assets/fonts/noto-sans-arabic-700.ttf",
    });
    expect(readFileSync(join(dir, "assets/fonts/noto-sans-arabic-700.ttf"))).toEqual(readFileSync(arabicFixture));
    await expect.poll(() => page.evaluate(() => Array.from(document.fonts).some(
      (face) => face.family === "Noto Sans Arabic" && face.weight === "700" && face.status === "loaded",
    ))).toBe(true);
    expect(assetRequests).toContain("assets/fonts/noto-sans-arabic-700.ttf");
    expect(await page.getByTestId("system-font-face-700").textContent()).toContain("Already in the project");

    await page.getByRole("button", { name: "Back to fonts" }).click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe("Import from system");
    const row = page.getByTestId("font-row-Noto Sans Arabic-700");
    await row.waitFor({ state: "visible" });
    expect(await row.textContent()).toContain("uploaded");
    expect(await page.evaluate(() => Array.from(document.fonts).some((face) => face.family.startsWith("__system-preview-")))).toBe(false);

    await row.getByRole("button", { name: "Remove" }).click();
    await row.waitFor({ state: "detached" });
    await page.close();
  });
});
