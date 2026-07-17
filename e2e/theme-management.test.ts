// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/sample/assets");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "theme-management-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  const project = JSON.parse(readFileSync(sample, "utf8"));
  const headline = project.layouts[0].screens[0].elements.find((element: { id: string }) => element.id === "headline");
  headline.name = "Theme headline";
  writeFileSync(projectFile, JSON.stringify(project));
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "themes"));
  writeFileSync(join(dir, "themes/midnight.json"), JSON.stringify({
    id: "midnight",
    name: "Midnight",
    colors: { heading: "#12ABCD", body: "#CBD5E1", accent: "#38BDF8", surface: "#0F172A" },
    fonts: { heading: { family: "Pacifico", weight: 400 } },
  }));
  process.env.PROJECT_PATH = projectFile;
  server = await startWebServer(undefined, { storeSpecsPath: resolve(repoRoot, "store-specs.json") });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function headline() {
  const project = JSON.parse(readFileSync(projectFile, "utf8"));
  return project.layouts[0].screens[0].elements.find((element: { id: string }) => element.id === "headline");
}

describe("theme management UI", () => {
  it("assigns a role, applies a theme, persists, and reloads", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    await page.getByRole("button", { name: "Theme headline", exact: true }).click();
    await page.getByRole("button", { name: "Theme role", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "heading", exact: true }).click();
    await expect.poll(() => headline().role).toBe("heading");

    await page.getByRole("button", { name: "Resources panel", exact: true }).click();
    await page.getByRole("button", { name: "Themes", exact: true }).click();
    const row = page.getByTestId("theme-row-midnight");
    await row.waitFor({ state: "visible" });
    let releaseApply!: () => void;
    const applyGate = new Promise<void>((resolve) => { releaseApply = resolve; });
    await page.route("**/api/themes", async (route) => {
      if (route.request().method() === "POST") await applyGate;
      await route.continue();
    });
    await row.getByRole("button", { name: "Apply", exact: true }).click();
    const closeButton = page.getByRole("button", { name: "Close theme picker", exact: true });
    try {
      await page.getByRole("button", { name: "Applying…", exact: true }).waitFor();
      expect(await closeButton.isDisabled()).toBe(true);
      await page.getByRole("dialog", { name: "Theme picker" }).locator("..").click({ position: { x: 4, y: 4 } });
      expect(await page.getByRole("dialog", { name: "Theme picker" }).isVisible()).toBe(true);
    } finally {
      releaseApply();
    }
    await expect.poll(() => headline().color).toBe("#12ABCD");
    expect(headline()).toMatchObject({ role: "heading", fontFamily: "Pacifico", weight: 400 });

    await page.getByRole("button", { name: "Close theme picker", exact: true }).click();
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("canvas");
    await page.getByRole("button", { name: "Theme headline", exact: true }).click();
    expect(await page.getByRole("button", { name: "Theme role", exact: true }).textContent()).toContain("heading");
    await page.close();
  });
});
