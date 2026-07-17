// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

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
  it("inserts screenshot, decorative image, and device-frame types into the connected owner", async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Add element" }).click();
    await page.getByRole("button", { name: "Screenshot", exact: true }).click();
    const screenshotDialog = page.getByRole("dialog", { name: "Screenshot asset picker" });
    await screenshotDialog.waitFor({ state: "visible" });
    const screenshotOption = screenshotDialog.getByRole("button", {
      name: "Use assets/demo-logistics-app.png",
    });
    await screenshotOption.waitFor();
    await expect.poll(() => screenshotOption.locator("img").evaluate((image) => (
      image.complete && image.naturalWidth > 0
    ))).toBe(true);
    await screenshotOption.click();

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

    await page.getByRole("button", { name: "Device Frame", exact: true }).click();
    const frameDialog = page.getByRole("dialog", { name: "Device frame asset picker" });
    await frameDialog.waitFor({ state: "visible" });
    await frameDialog.getByRole("button", { name: "Use assets/demo-logistics-app.png" }).click();

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

    await page.getByLabel("Frame preset", { exact: true }).click();
    await page.getByRole("menuitemradio", { name: "desktop", exact: true }).click();
    await expect.poll(() => project().layouts[0].screens[0].elements.at(-1)).toMatchObject({
      deviceType: "desktop", width: 300, height: 187.5,
    });

    await page.reload({ waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });
    expect(await page.getByText("Loading workspace…").count()).toBe(0);

    await page.close();
  });
});
