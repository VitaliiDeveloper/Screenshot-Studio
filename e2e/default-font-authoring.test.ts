// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "default-font-authoring-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  const project = JSON.parse(readFileSync(sample, "utf8"));
  project.fonts = [];
  for (const layout of project.layouts) {
    for (const screen of layout.screens) screen.elements = [];
  }
  writeFileSync(projectFile, JSON.stringify(project));
  server = await startWebServer(undefined, {
    projectPath: projectFile,
    storeSpecsPath: resolve(repoRoot, "store-specs.json"),
  });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("default font authoring", () => {
  it("adds text immediately in a project with no custom fonts", async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    await page.getByRole("button", { name: "Add element", exact: true }).click();
    await page.getByRole("button", { name: "+ Text", exact: true }).click();

    await expect.poll(() => {
      const project = JSON.parse(readFileSync(projectFile, "utf8"));
      return project.layouts[0].screens[0].elements.at(-1);
    }, { timeout: 10_000 }).toMatchObject({
      type: "text",
      fontFamily: "Screenshot Studio Sans",
      weight: 400,
    });
    expect(await page.getByText("Upload file", { exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Font", exact: true }).textContent())
      .toContain("Studio Sans · Regular · Built-in");
    expect(await page.evaluate(() => Array.from(document.fonts).some(
      (face) => face.family === "Screenshot Studio Sans" && face.status === "loaded",
    ))).toBe(true);

    await page.close();
  });
});
