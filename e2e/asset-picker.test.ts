// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/phase-6-connected/app-store-screenshots.json");
const imagePath = resolve(repoRoot, "fixtures/phase-0-sample/assets/demo-logistics-app.png");

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
  server = await startWebServer();
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

describe("Phase 6 asset picker", () => {
  it("inserts existing screenshot and device-frame types into the connected owner", async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Add panel" }).click();
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

    await expect.poll(() => project().screens[0].elements.length).toBe(2);
    expect(project().screens[0].elements.at(-1)).toMatchObject({
      type: "screenshot",
      assetUrl: "assets/demo-logistics-app.png",
      fit: "cover",
      x: 100,
      y: 100,
      width: 300,
      height: 300,
    });
    expect(project().screens[1].elements).toHaveLength(1);

    await page.getByRole("button", { name: "iPhone Device Frame", exact: true }).click();
    const frameDialog = page.getByRole("dialog", { name: "Device frame asset picker" });
    await frameDialog.waitFor({ state: "visible" });
    await frameDialog.getByRole("button", { name: "Use assets/demo-logistics-app.png" }).click();

    await expect.poll(() => project().screens[0].elements.length).toBe(3);
    expect(project().screens[0].elements.at(-1)).toMatchObject({
      type: "device-frame",
      deviceType: "iphone",
      assetUrl: "assets/demo-logistics-app.png",
      fit: "cover",
      x: 100,
      y: 100,
      width: 300,
      height: 650,
    });
    expect(project().screens[1].elements).toHaveLength(1);

    await page.reload({ waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });
    expect(await page.getByText("Loading workspace…").count()).toBe(0);

    await page.close();
  });
});
