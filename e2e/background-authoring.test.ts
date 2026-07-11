// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const imagePath = resolve(repoRoot, "fixtures/phase-0-sample/assets/demo-logistics-app.png");

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "background-authoring-"));
  mkdirSync(join(directory, "assets"), { recursive: true });
  cpSync(imagePath, join(directory, "assets", "background.png"));
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Background authoring", schemaVersion: 7 },
    mode: "isolated", platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      direction: "ltr", artboard: { width: 300, height: 300 },
      background: { type: "solid", color: "#FFFFFF" }, elements: [],
    }],
  }));
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

function background(): Record<string, unknown> {
  const project = JSON.parse(readFileSync(projectPath, "utf8")) as {
    screens: Array<{ background: Record<string, unknown> }>;
  };
  return project.screens[0]!.background;
}

describe("Phase 9 background authoring", () => {
  it("edits a gradient, chooses a project image, and reloads persisted state", async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const inspector = page.locator("aside").filter({ has: page.getByRole("heading", { name: "Inspector" }) });

    await inspector.getByLabel("Type", { exact: true }).click();
    await page.getByRole("menuitemradio", { name: "linear-gradient", exact: true }).click();
    await inspector.getByLabel("From", { exact: true }).fill("#112233");
    await inspector.getByLabel("From", { exact: true }).blur();
    await inspector.getByLabel("To", { exact: true }).fill("#aabbcc");
    await inspector.getByLabel("To", { exact: true }).blur();
    await inspector.getByLabel("Angle", { exact: true }).fill("45");
    await inspector.getByLabel("Angle", { exact: true }).blur();
    await expect.poll(() => background()).toMatchObject({
      type: "linear-gradient", from: "#112233", to: "#aabbcc", angle: 45,
    });

    await inspector.getByLabel("Type", { exact: true }).click();
    await page.getByRole("menuitemradio", { name: "image", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Background asset picker" });
    await dialog.waitFor({ state: "visible" });
    await dialog.getByRole("button", { name: "Use assets/background.png" }).click();
    await inspector.getByLabel("Fit", { exact: true }).click();
    await page.getByRole("menuitemradio", { name: "contain", exact: true }).click();
    await inspector.getByLabel("Fallback", { exact: true }).fill("#123456");
    await inspector.getByLabel("Fallback", { exact: true }).blur();
    await expect.poll(() => background()).toMatchObject({
      type: "image", assetUrl: "assets/background.png", fit: "contain", color: "#123456",
    });

    await page.reload({ waitUntil: "load" });
    await expect.poll(() => inspector.getByLabel("Type", { exact: true }).textContent()).toContain("image");
    expect(background()).toMatchObject({
      type: "image", assetUrl: "assets/background.png", fit: "contain", color: "#123456",
    });
    await page.close();
  });
});
