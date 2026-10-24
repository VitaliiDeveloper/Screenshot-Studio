// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  directory = mkdtempSync(join(tmpdir(), "project-images-"));
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, readFileSync(fixturePath, "utf8"));
  mkdirSync(join(directory, "assets"), { recursive: true });
  cpSync(imagePath, join(directory, "assets", "demo-logistics-app.png"));
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

function screenElements() {
  return JSON.parse(readFileSync(projectPath, "utf8")).layouts[0].screens[0].elements;
}

describe("Project images rail item", () => {
  it("lists project images, imports without inserting, and inserts the selected image", async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });
    const initialElements = screenElements();

    await page.getByRole("button", { name: "Project images" }).click();
    const dialog = page.getByRole("dialog", { name: "Project images" });
    await dialog.getByRole("button", { name: "assets/demo-logistics-app.png" }).waitFor();
    const insert = dialog.getByRole("button", { name: "Insert as image" });
    expect(await insert.isDisabled()).toBe(true);

    await dialog.getByLabel("Choose image from device").setInputFiles({
      name: "rail-import.png",
      mimeType: "image/png",
      buffer: readFileSync(imagePath),
    });
    const imported = dialog.getByRole("button", { name: "assets/imported/rail-import.png" });
    await imported.waitFor();
    expect(await imported.getAttribute("aria-pressed")).toBe("true");
    expect(existsSync(join(directory, "assets/imported/rail-import.png"))).toBe(true);
    expect(screenElements()).toEqual(initialElements);

    await insert.click();
    await dialog.waitFor({ state: "hidden" });
    await expect.poll(() => screenElements().length).toBe(initialElements.length + 1);
    expect(screenElements().at(-1)).toMatchObject({
      type: "image",
      assetUrl: "assets/imported/rail-import.png",
      fit: "contain",
    });
    await page.close();
  }, 120_000);
});
