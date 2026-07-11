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
  directory = mkdtempSync(join(tmpdir(), "styling-authoring-"));
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Styling authoring", schemaVersion: 9 }, mode: "isolated",
    platforms: ["apple"], locales: ["en"], fonts: [],
    screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
      artboard: { width: 300, height: 300 }, background: { type: "solid", color: "#FFFFFF" },
      elements: [
        { id: "title", name: "Title", type: "text", x: 20, y: 20, width: 260, height: 80, content: "Hello", fontFamily: "Inter", size: 40, weight: 400, lineHeight: 1.2, letterSpacing: 0, align: "center", color: "#000000", rotation: 0, opacity: 1, locked: false, visible: true },
        { id: "shape", name: "Accent", type: "shape", x: 50, y: 130, width: 200, height: 120, kind: "rect", fill: "#3366FF", radius: 12, rotation: 0, opacity: 1, locked: false, visible: true },
      ],
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

function elements(): Array<Record<string, unknown>> {
  return (JSON.parse(readFileSync(projectPath, "utf8")) as {
    screens: Array<{ elements: Array<Record<string, unknown>> }>;
  }).screens[0]!.elements;
}

describe("Phase 9 styling authoring", () => {
  it("persists text shadow and ellipse gradient stroke from named controls", async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const layers = page.getByRole("list", { name: "Layers for Hero" });
    const inspector = page.locator("aside").filter({ has: page.getByRole("heading", { name: "Inspector" }) });

    await layers.getByRole("button", { name: "Title", exact: true }).click();
    await inspector.getByRole("button", { name: "Add shadow" }).click();
    await inspector.getByLabel("Shadow blur", { exact: true }).fill("18");
    await inspector.getByLabel("Shadow blur", { exact: true }).blur();

    await layers.getByRole("button", { name: "Accent", exact: true }).click();
    await inspector.getByLabel("Kind", { exact: true }).click();
    await page.getByRole("menuitemradio", { name: "ellipse", exact: true }).click();
    await inspector.getByRole("button", { name: "Add gradient" }).click();
    await inspector.getByLabel("Gradient angle", { exact: true }).fill("45");
    await inspector.getByLabel("Gradient angle", { exact: true }).blur();
    await inspector.getByRole("button", { name: "Add stroke" }).click();
    await inspector.getByLabel("Stroke width", { exact: true }).fill("6");
    await inspector.getByLabel("Stroke width", { exact: true }).blur();

    await expect.poll(() => elements().find((element) => element.id === "title")).toMatchObject({
      shadow: { blur: 18 },
    });
    await expect.poll(() => elements().find((element) => element.id === "shape")).toMatchObject({
      kind: "ellipse", gradient: { angle: 45 }, stroke: { width: 6 },
    });
    await page.reload({ waitUntil: "load" });
    expect(elements().find((element) => element.id === "shape")).toMatchObject({
      kind: "ellipse", gradient: { angle: 45 }, stroke: { width: 6 },
    });
    await page.close();
  });
});
