// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/regressions/connected-canvas/app-store-screenshots.json");
const imagePath = resolve(repoRoot, "fixtures/sample/assets/demo-logistics-app.png");

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "asset-picker-"));
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, readFileSync(fixturePath));
  mkdirSync(join(directory, "assets"), { recursive: true });
  cpSync(imagePath, join(directory, "assets", "demo-logistics-app.png"), { recursive: true });
  process.env.PROJECT_PATH = projectPath;
  server = await startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(directory, { recursive: true, force: true });
});

function project() {
  return JSON.parse(readFileSync(projectPath, "utf8"));
}

describe("Project asset picker", () => {
  it("inserts project images and lets a device mockup remove and reassign its screenshot", async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });

    let delayFirstAssetList = true;
    await page.route("**/api/assets", async (route) => {
      if (delayFirstAssetList && route.request().method() === "GET") {
        delayFirstAssetList = false;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
      }
      await route.continue();
    });

    await page.getByRole("button", { name: "Add element" }).click();
    await page.getByRole("button", { name: "Screenshot", exact: true }).click();
    const screenshotDialog = page.getByRole("dialog", { name: "Screenshot asset picker" });
    await screenshotDialog.waitFor({ state: "visible" });
    await screenshotDialog.getByRole("status", { name: "" }).filter({ hasText: "Scanning project images…" }).waitFor();
    await screenshotDialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map(({ finished }) => finished));
    });
    const loadingBox = await screenshotDialog.boundingBox();
    const screenshotOption = screenshotDialog.getByRole("button", {
      name: "Use assets/demo-logistics-app.png",
    });
    await screenshotOption.waitFor();
    const loadedBox = await screenshotDialog.boundingBox();
    expect(loadingBox).not.toBeNull();
    expect(loadedBox).not.toBeNull();
    expect(Math.abs(loadedBox!.height - loadingBox!.height)).toBeLessThan(1);
    const screenshotBackdrop = screenshotDialog.locator("..");
    expect(await screenshotBackdrop.getAttribute("data-motion")).toBe("open");
    await screenshotDialog.getByRole("button", { name: "Close asset picker" }).click();
    expect(await screenshotBackdrop.getAttribute("data-motion")).toBe("closing");
    await screenshotDialog.waitFor({ state: "hidden" });

    await page.getByRole("button", { name: "Screenshot", exact: true }).click();
    const reopenedScreenshotDialog = page.getByRole("dialog", { name: "Screenshot asset picker" });
    const reopenedScreenshotOption = reopenedScreenshotDialog.getByRole("button", {
      name: "Use assets/demo-logistics-app.png",
    });
    await reopenedScreenshotOption.waitFor();
    await expect.poll(() => reopenedScreenshotOption.locator("img").evaluate((image) => (
      image.complete && image.naturalWidth > 0
    ))).toBe(true);
    await reopenedScreenshotOption.click();
    await reopenedScreenshotDialog.waitFor({ state: "hidden" });

    await expect.poll(() => project().layouts[0].screens[0].elements.length).toBe(2);
    expect(project().layouts[0].screens[0].elements.at(-1)).toMatchObject({
      type: "screenshot",
      assetUrl: "assets/demo-logistics-app.png",
      fit: "cover",
      x: 100,
      y: 100,
      width: 300,
      height: 300,
    });
    expect(project().layouts[0].screens[1].elements).toHaveLength(1);

    await page.getByRole("button", { name: "Image", exact: true }).click();
    const imageDialog = page.getByRole("dialog", { name: "Image asset picker" });
    await imageDialog.waitFor({ state: "visible" });
    await imageDialog.getByRole("button", { name: "Use assets/demo-logistics-app.png" }).click();
    await imageDialog.waitFor({ state: "hidden" });

    await expect.poll(() => project().layouts[0].screens[0].elements.length).toBe(3);
    expect(project().layouts[0].screens[0].elements.at(-1)).toMatchObject({
      type: "image",
      assetUrl: "assets/demo-logistics-app.png",
      fit: "contain",
      cornerRadius: 0,
      x: 100,
      y: 100,
      width: 300,
      height: 300,
    });
    await page.getByLabel("Fit", { exact: true }).click();
    await page.getByRole("menuitemradio", { name: "cover", exact: true }).click();
    await page.getByLabel("Corner radius", { exact: true }).fill("24");
    await page.getByLabel("Corner radius", { exact: true }).blur();
    await page.getByLabel("Focal X %", { exact: true }).fill("25");
    await page.getByLabel("Focal X %", { exact: true }).blur();
    await page.getByLabel("Focal Y %", { exact: true }).fill("75");
    await page.getByLabel("Focal Y %", { exact: true }).blur();
    await page.getByLabel("Crop zoom", { exact: true }).fill("2");
    await page.getByLabel("Crop zoom", { exact: true }).blur();
    await expect.poll(() => project().layouts[0].screens[0].elements.at(-1)).toMatchObject({
      cornerRadius: 24,
      fit: "cover", crop: { x: 0.25, y: 0.75, zoom: 2 },
    });

    await page.getByRole("button", { name: "Place screenshot in mockup", exact: true }).click();
    const frameDialog = page.getByRole("dialog", { name: "Device frame asset picker" });
    await frameDialog.waitFor({ state: "visible" });
    await frameDialog.getByRole("button", { name: "Use assets/demo-logistics-app.png" }).click();
    await frameDialog.waitFor({ state: "hidden" });

    await expect.poll(() => project().layouts[0].screens[0].elements.length).toBe(4);
    expect(project().layouts[0].screens[0].elements.at(-1)).toMatchObject({
      type: "device-frame",
      deviceType: "iphone",
      assetUrl: "assets/demo-logistics-app.png",
      fit: "cover",
      x: 100,
      y: 100,
      width: 300,
      height: 650,
    });
    expect(project().layouts[0].screens[1].elements).toHaveLength(1);

    await page.getByRole("button", { name: "Remove screenshot from device mockup" }).click();
    await expect.poll(() => project().layouts[0].screens[0].elements.at(-1).assetUrl).toBeUndefined();
    await page.getByText("No screenshot assigned", { exact: true }).waitFor();

    await page.getByRole("button", { name: "Choose screenshot", exact: true }).click();
    const assignmentDialog = page.getByRole("dialog", { name: "Device frame asset picker" });
    await assignmentDialog.getByRole("button", { name: "Use assets/demo-logistics-app.png" }).click();
    await assignmentDialog.waitFor({ state: "hidden" });
    await expect.poll(() => project().layouts[0].screens[0].elements.at(-1).assetUrl)
      .toBe("assets/demo-logistics-app.png");
    expect(project().layouts[0].screens[0].elements).toHaveLength(4);

    await page.getByLabel("Frame preset", { exact: true }).click();
    await page.getByRole("menuitemradio", { name: "desktop", exact: true }).click();
    await expect.poll(() => project().layouts[0].screens[0].elements.at(-1)).toMatchObject({
      deviceType: "desktop", width: 300, height: 187.5,
    });

    await page.getByRole("button", { name: "Replace screenshot", exact: true }).click();
    const importDialog = page.getByRole("dialog", { name: "Device frame asset picker" });
    await importDialog.getByLabel("Choose image from device").setInputFiles({
      name: "finder-device-shot.png",
      mimeType: "image/png",
      buffer: readFileSync(imagePath),
    });
    await importDialog.waitFor({ state: "hidden" });
    await expect.poll(() => project().layouts[0].screens[0].elements.at(-1).assetUrl)
      .toBe("assets/imported/finder-device-shot.png");
    expect(readFileSync(join(directory, "assets/imported/finder-device-shot.png")))
      .toEqual(readFileSync(imagePath));

    await page.reload({ waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });
    expect(await page.getByText("Loading workspace…").count()).toBe(0);

    await page.close();
  });
});
