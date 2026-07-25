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
const MAX_INITIAL_MEDIA_HEIGHT = 600;

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "asset-picker-"));
  projectPath = join(directory, "app-store-screenshots.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  fixture.layouts[0].screens.push({
    id: "wear-target",
    name: "Wear Target",
    platform: "android",
    device: "wear",
    locale: "en",
    direction: "ltr",
    artboard: { width: 384, height: 400 },
    background: { type: "solid", color: "#101010" },
    elements: [],
  });
  writeFileSync(projectPath, `${JSON.stringify(fixture, null, 2)}\n`);
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

function expectInitialMediaSize(
  element: { width: number; height: number },
  source: { width: number; height: number },
) {
  expect(element.height).toBe(MAX_INITIAL_MEDIA_HEIGHT);
  expect(element.width / element.height).toBeCloseTo(source.width / source.height);
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
    const screenshotThumbnail = reopenedScreenshotOption.locator("img");
    await expect.poll(() => screenshotThumbnail.evaluate((image) => (
      image.complete && image.naturalWidth > 0
    ))).toBe(true);
    const sourceDimensions = await screenshotThumbnail.evaluate((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }));
    await reopenedScreenshotOption.click();
    await reopenedScreenshotDialog.waitFor({ state: "hidden" });

    await expect.poll(() => project().layouts[0].screens[0].elements.length).toBe(2);
    const insertedScreenshot = project().layouts[0].screens[0].elements.at(-1);
    expect(insertedScreenshot).toMatchObject({
      type: "screenshot",
      assetUrl: "assets/demo-logistics-app.png",
      fit: "cover",
      x: 100,
      y: 100,
    });
    expectInitialMediaSize(insertedScreenshot, sourceDimensions);
    expect(project().layouts[0].screens[1].elements).toHaveLength(1);

    await page.getByRole("button", { name: "Image", exact: true }).click();
    const imageDialog = page.getByRole("dialog", { name: "Image asset picker" });
    await imageDialog.waitFor({ state: "visible" });
    await imageDialog.getByRole("button", { name: "Use assets/demo-logistics-app.png" }).click();
    await imageDialog.waitFor({ state: "hidden" });

    await expect.poll(() => project().layouts[0].screens[0].elements.length).toBe(3);
    const insertedImage = project().layouts[0].screens[0].elements.at(-1);
    expect(insertedImage).toMatchObject({
      type: "image",
      assetUrl: "assets/demo-logistics-app.png",
      fit: "contain",
      cornerRadius: 0,
      x: 100,
      y: 100,
    });
    expectInitialMediaSize(insertedImage, sourceDimensions);
    const insertedImageId = insertedImage.id;
    await page.getByRole("button", { name: "Fill", exact: true }).click();
    await page.getByRole("button", { name: "Soft", exact: true }).click();
    const cornerRadius = page.getByRole("spinbutton", { name: "Exact value", exact: true });
    await cornerRadius.fill("108");
    await cornerRadius.blur();
    await page.getByRole("button", { name: "Focal point", exact: true }).press("ArrowRight");
    await page.getByRole("button", { name: "Increase crop zoom", exact: true }).click();
    await page.getByRole("button", { name: "Add blur", exact: true }).click();
    await expect.poll(() => project().layouts[0].screens[0].elements
      .find((element: { id: string }) => element.id === insertedImageId)?.blur).toBe(8);
    await page.getByRole("button", { name: "Remove blur", exact: true }).click();
    await expect.poll(() => project().layouts[0].screens[0].elements
      .find((element: { id: string }) => element.id === insertedImageId)).not.toHaveProperty("blur");
    await page.getByRole("button", { name: "Add blur", exact: true }).click();

    await page.getByRole("spinbutton", { name: "X", exact: true }).fill("140");
    await page.getByRole("spinbutton", { name: "X", exact: true }).blur();
    await page.getByRole("spinbutton", { name: "Y", exact: true }).fill("120");
    await page.getByRole("spinbutton", { name: "Y", exact: true }).blur();
    await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("320");
    await page.getByRole("spinbutton", { name: "Width", exact: true }).blur();
    await page.getByRole("spinbutton", { name: "Rotation", exact: true }).fill("5");
    await page.getByRole("spinbutton", { name: "Rotation", exact: true }).blur();
    const opacity = page.getByRole("slider", { name: "Opacity", exact: true });
    await opacity.fill("65");
    await opacity.blur();

    await expect.poll(() => project().layouts[0].screens[0].elements
      .find((element: { id: string }) => element.id === insertedImageId)).toMatchObject({
      x: 140,
      y: 120,
      width: 320,
      rotation: 5,
      opacity: 0.65,
      cornerRadius: 108,
      fit: "cover",
      crop: { x: 0.51, y: 0.5, zoom: 1.1 },
      blur: 8,
    });

    const beforeReplacement = project().layouts[0].screens[0].elements
      .find((element: { id: string }) => element.id === insertedImageId);
    const elementCountBeforeReplacement = project().layouts[0].screens[0].elements.length;
    await page.getByRole("button", { name: "Replace", exact: true }).click();
    const replacementDialog = page.getByRole("dialog", { name: "Image asset picker" });
    await replacementDialog.getByLabel("Choose image from device").setInputFiles({
      name: "finder-media-replacement.png",
      mimeType: "image/png",
      buffer: readFileSync(imagePath),
    });
    await replacementDialog.waitFor({ state: "hidden" });
    await expect.poll(() => project().layouts[0].screens[0].elements
      .find((element: { id: string }) => element.id === insertedImageId)?.assetUrl)
      .toBe("assets/imported/finder-media-replacement.png");
    const afterReplacement = project().layouts[0].screens[0].elements
      .find((element: { id: string }) => element.id === insertedImageId);
    expect(project().layouts[0].screens[0].elements).toHaveLength(elementCountBeforeReplacement);
    expect({ ...afterReplacement, assetUrl: beforeReplacement.assetUrl }).toEqual(beforeReplacement);

    await page.getByRole("button", { name: "Place screenshot in mockup", exact: true }).click();
    const frameDialog = page.getByRole("dialog", { name: "Mockup screenshot picker" });
    await frameDialog.waitFor({ state: "visible" });
    await frameDialog.getByRole("button", { name: "Use assets/demo-logistics-app.png" }).click();
    await frameDialog.waitFor({ state: "hidden" });

    await expect.poll(() => project().layouts[0].screens[0].elements.length).toBe(4);
    expect(project().layouts[0].screens[0].elements.at(-1)).toMatchObject({
      type: "device-frame",
      deviceType: "phone-modern-dark",
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
    const assignmentDialog = page.getByRole("dialog", { name: "Mockup screenshot picker" });
    await assignmentDialog.getByRole("button", { name: "Use assets/demo-logistics-app.png" }).click();
    await assignmentDialog.waitFor({ state: "hidden" });
    await expect.poll(() => project().layouts[0].screens[0].elements.at(-1).assetUrl)
      .toBe("assets/demo-logistics-app.png");
    expect(project().layouts[0].screens[0].elements).toHaveLength(4);

    await page
      .getByLabel("Content mode", { exact: true })
      .getByRole("button", { name: "Fit", exact: true })
      .click();
    await page.getByRole("button", { name: "Add content blur" }).click();
    await page.getByLabel("X", { exact: true }).fill("140");
    await page.getByLabel("X", { exact: true }).blur();
    await page.getByLabel("Y", { exact: true }).fill("120");
    await page.getByLabel("Y", { exact: true }).blur();
    await page.getByLabel("Width", { exact: true }).fill("320");
    await page.getByLabel("Width", { exact: true }).blur();
    await page.getByLabel("Rotation", { exact: true }).fill("5");
    await page.getByLabel("Rotation", { exact: true }).blur();

    const chooseFrame = page.getByRole("button", { name: "Choose frame", exact: true });
    await chooseFrame.click();
    const presetDialog = page.getByRole("dialog", { name: "Device frame picker" });
    await presetDialog.waitFor({ state: "visible" });
    await expect.poll(() => presetDialog.getByText("phone-modern-dark", { exact: true }).count()).toBe(0);
    const selectedFrame = presetDialog.getByRole("button", {
      name: "Modern Phone — Dark, Recommended",
    });
    expect(await selectedFrame.getAttribute("aria-pressed")).toBe("true");
    await presetDialog.getByLabel("Search frames").fill("phone-modern-dark");
    await presetDialog.getByText("No frames match", { exact: false }).waitFor();
    await presetDialog.getByLabel("Search frames").fill("");
    const modernDark = presetDialog.getByRole("button", { name: "Modern Phone — Dark, Recommended" });
    const adjacentPhone = presetDialog.getByRole("button", { name: "Modern Phone — Light" });
    await modernDark.focus();
    await modernDark.press("ArrowRight");
    await expect.poll(() => adjacentPhone.evaluate((element) => document.activeElement === element)).toBe(true);
    await adjacentPhone.press("Escape");
    await presetDialog.waitFor({ state: "hidden" });
    await expect.poll(() => chooseFrame.evaluate((element) => document.activeElement === element)).toBe(true);

    await chooseFrame.click();
    const reopenedPresetDialog = page.getByRole("dialog", { name: "Device frame picker" });
    const minimalDisplays = reopenedPresetDialog.getByRole("button", { name: "Minimal Display" });
    await expect.poll(() => minimalDisplays.count()).toBe(2);
    const computerMinimalDisplay = minimalDisplays.nth(0);
    const flatTv = reopenedPresetDialog.getByRole("button", { name: "Flat TV" });
    const tvMinimalDisplay = minimalDisplays.nth(1);
    const roundedWatch = reopenedPresetDialog.getByRole("button", { name: /^Rounded Watch/ });
    await computerMinimalDisplay.focus();
    await computerMinimalDisplay.press("ArrowRight");
    await expect.poll(() => flatTv.evaluate((element) => document.activeElement === element)).toBe(true);
    await flatTv.press("ArrowRight");
    await expect.poll(() => tvMinimalDisplay.evaluate((element) => document.activeElement === element)).toBe(true);
    await tvMinimalDisplay.press("ArrowRight");
    await expect.poll(() => roundedWatch.evaluate((element) => document.activeElement === element)).toBe(true);
    await roundedWatch.press("ArrowLeft");
    await expect.poll(() => tvMinimalDisplay.evaluate((element) => document.activeElement === element)).toBe(true);
    await tvMinimalDisplay.press("Enter");
    await reopenedPresetDialog.waitFor({ state: "hidden" });
    await expect.poll(() => chooseFrame.evaluate((element) => document.activeElement === element)).toBe(true);
    await expect.poll(() => project().layouts[0].screens[0].elements.at(-1)).toMatchObject({
      deviceType: "display-minimal",
      assetUrl: "assets/demo-logistics-app.png",
      fit: "contain",
      blur: 8,
      x: 140,
      y: 120,
      width: 320,
      height: 180,
      rotation: 5,
    });

    await page.getByRole("button", { name: "Replace screenshot", exact: true }).click();
    const importDialog = page.getByRole("dialog", { name: "Mockup screenshot picker" });
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
    const reloadedImage = project().layouts[0].screens[0].elements
      .find((element: { id: string }) => element.id === insertedImageId);
    expect(reloadedImage).toMatchObject({
      assetUrl: "assets/imported/finder-media-replacement.png",
      fit: "cover",
      cornerRadius: 108,
      crop: { x: 0.51, y: 0.5, zoom: 1.1 },
      blur: 8,
      opacity: 0.65,
      x: 140,
      y: 120,
      width: 320,
      rotation: 5,
    });

    const siblingsBeforeRemoval = project().layouts[0].screens[0].elements
      .filter((element: { id: string }) => element.id !== insertedImageId)
      .map((element: { id: string }) => element.id);
    await page.getByRole("button", { name: "Structure panel", exact: true }).click();
    await page.getByRole("list", { name: "Layers for Connected First" })
      .getByRole("button", { name: "Image", exact: true }).click();
    await page.getByRole("button", { name: "Remove image element", exact: true }).click();
    await expect.poll(() => project().layouts[0].screens[0].elements
      .some((element: { id: string }) => element.id === insertedImageId)).toBe(false);
    expect(project().layouts[0].screens[0].elements
      .map((element: { id: string }) => element.id)).toEqual(siblingsBeforeRemoval);

    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await page.getByRole("button", {
      name: "Edit Google Play · Wear OS connected row",
      exact: true,
    }).click();
    await page.getByRole("button", { name: "Add element", exact: true }).click();
    await page.getByRole("button", { name: "Place screenshot in mockup", exact: true }).click();
    const wearAssetDialog = page.getByRole("dialog", { name: "Mockup screenshot picker" });
    await wearAssetDialog.getByRole("button", { name: "Use assets/demo-logistics-app.png" }).click();
    await wearAssetDialog.waitFor({ state: "hidden" });

    const wearElements = () => project().layouts[0].screens
      .find((screen: { id: string }) => screen.id === "wear-target").elements;
    await expect.poll(() => wearElements().at(-1)).toMatchObject({
      type: "device-frame",
      deviceType: "frameless-watch",
      width: 300,
      height: 300,
    });

    const wearChooseFrame = page.getByRole("button", { name: "Choose frame", exact: true });
    await wearChooseFrame.click();
    const wearPresetDialog = page.getByRole("dialog", { name: "Device frame picker" });
    await expect.poll(() => wearPresetDialog.getByText("Recommended", { exact: true }).count()).toBe(0);
    const framelessWatch = wearPresetDialog.getByRole("button", { name: "Frameless Watch", exact: true });
    expect(await framelessWatch.getAttribute("aria-pressed")).toBe("true");
    await framelessWatch.click();
    await wearPresetDialog.waitFor({ state: "hidden" });
    await expect.poll(() => wearElements().at(-1)).toMatchObject({
      deviceType: "frameless-watch",
      width: 300,
      height: 300,
    });

    await wearChooseFrame.click();
    const reopenedWearPresetDialog = page.getByRole("dialog", { name: "Device frame picker" });
    await reopenedWearPresetDialog.getByRole("button", { name: /^Square Watch/ }).click();
    await reopenedWearPresetDialog.waitFor({ state: "hidden" });
    await expect.poll(() => wearElements().at(-1)).toMatchObject({
      deviceType: "watch-square",
      width: 300,
      height: 300,
    });

    await page.close();
  });
});
