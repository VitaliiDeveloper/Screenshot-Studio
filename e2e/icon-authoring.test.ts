// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "icon-authoring-"));
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Icon authoring", schemaVersion: 7 },
    mode: "isolated",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [{
      id: "first", name: "First", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
      artboard: { width: 300, height: 300 }, background: { type: "solid", color: "#FFFFFF" },
      elements: [],
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

function elements() {
  return (JSON.parse(readFileSync(projectPath, "utf8")) as {
    screens: Array<{ elements: Array<Record<string, unknown>> }>;
  }).screens[0]!.elements;
}

describe("Phase 7 icon authoring", () => {
  it("inserts a trusted icon, edits its literals, and reloads persisted state", async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.getByRole("button", { name: "Add panel" }).click();
    await page.getByRole("button", { name: "Icon", exact: true }).click();
    await expect.poll(() => elements().length).toBe(1);
    expect(elements()[0]).toMatchObject({
      type: "icon", icon: "star", color: "#3B82F6", strokeWidth: 2,
      x: 100, y: 100, width: 160, height: 160,
    });

    const inspector = page.locator("aside").filter({ has: page.getByRole("heading", { name: "Inspector" }) });
    await inspector.getByLabel("Icon", { exact: true }).click();
    await page.getByRole("menuitemradio", { name: "heart", exact: true }).click();
    await inspector.getByLabel("Color", { exact: true }).fill("#ff0066");
    await inspector.getByLabel("Color", { exact: true }).blur();
    await inspector.getByLabel("Stroke width", { exact: true }).fill("5");
    await inspector.getByLabel("Stroke width", { exact: true }).blur();
    await expect.poll(() => elements()[0]?.strokeWidth).toBe(5);
    expect(elements()[0]).toMatchObject({ icon: "heart", color: "#ff0066" });

    await page.reload({ waitUntil: "load" });
    const layers = page.getByRole("list", { name: "Layers for First" });
    await layers.waitFor({ state: "visible" });
    await layers.getByRole("button", { name: "Icon", exact: true }).click();
    await expect.poll(() => inspector.getByLabel("Icon", { exact: true }).textContent()).toContain("heart");
    expect(elements()[0]).toMatchObject({ icon: "heart", color: "#ff0066", strokeWidth: 5 });
    await page.close();
  });
});
