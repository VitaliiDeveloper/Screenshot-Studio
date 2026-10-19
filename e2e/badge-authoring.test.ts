// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fontSource = resolve(repoRoot, "fixtures/sample/assets/fonts/Pacifico-Regular.ttf");
const imageSource = resolve(repoRoot, "fixtures/sample/assets/demo-logistics-app.png");

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "badge-authoring-"));
  mkdirSync(join(directory, "assets", "fonts"), { recursive: true });
  cpSync(fontSource, join(directory, "assets", "fonts", "pacifico.ttf"));
  cpSync(imageSource, join(directory, "assets", "store-badge.png"));
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Badge authoring", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Default", mode: "isolated",
      screens: [{
        id: "first", name: "First", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 660, height: 600 }, background: { type: "solid", color: "#FFFFFF" },
        elements: [],
      }],
    }],
  }));
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
  return JSON.parse(readFileSync(projectPath, "utf8")) as {
    fonts: Array<Record<string, unknown>>;
    layouts: Array<{
      screens: Array<{ elements: Array<Record<string, unknown> & { children?: Array<Record<string, unknown>> }> }>;
    }>;
  };
}

function elements() {
  return project().layouts[0].screens[0]!.elements;
}

describe("badge authoring", () => {
  it("uses the built-in font fallback and inserts editable grouped and official-image badges", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.getByRole("button", { name: "Add element" }).click();
    await page.getByRole("button", { name: "Rating badge", exact: true }).click();
    await expect.poll(() => elements().length).toBe(1);
    expect(elements()[0]).toMatchObject({ type: "group", name: "Rating badge", width: 420, height: 120 });
    expect(elements()[0]!.children?.map((child) => child.type)).toEqual(["shape", "icon", "text"]);
    expect(elements()[0]!.children?.[2]).toMatchObject({
      fontFamily: "Screenshot Studio Sans",
      weight: 400,
    });

    await page.getByRole("button", { name: "As seen on badge", exact: true }).click();
    await expect.poll(() => elements().length).toBe(2);
    expect(elements()[1]).toMatchObject({ type: "group", name: "As seen on badge" });

    await page.getByRole("button", { name: "Store badge", exact: true }).click();
    const storeDialog = page.getByRole("dialog", { name: "Store badge asset picker" });
    await storeDialog.waitFor({ state: "visible" });
    await storeDialog.getByRole("button", { name: "Use assets/store-badge.png" }).click();
    await expect.poll(() => elements().length).toBe(3);
    expect(elements()[2]).toMatchObject({
      type: "image", name: "Store badge", assetUrl: "assets/store-badge.png",
      fit: "contain", width: 420, height: 140,
    });

    await page.getByRole("button", { name: "Layers panel" }).click();
    const layers = page.getByRole("list", { name: "Layers for First" });
    await layers.getByRole("button", { name: "Rating copy", exact: true }).click();
    const content = page.locator("textarea");
    await content.waitFor({ state: "visible" });
    await content.fill("4.8 • Loved by teams");
    await content.blur();
    await expect.poll(() => elements()[0]!.children?.[2]?.content).toBe("4.8 • Loved by teams");

    await page.reload({ waitUntil: "load" });
    expect(elements()).toHaveLength(3);
    expect(elements()[0]!.children?.[2]?.content).toBe("4.8 • Loved by teams");
    await page.close();
  });
});
