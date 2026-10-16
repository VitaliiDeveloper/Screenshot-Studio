// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/sample/assets");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;
let initialScreenCount: number;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "template-library-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  const project = JSON.parse(readFileSync(sample, "utf8"));
  project.layouts[0].screens[0] = {
    ...project.layouts[0].screens[0],
    name: "Computer target",
    platform: "apple",
    device: "macos",
    artboard: { width: 2880, height: 1800 },
    elements: [],
  };
  initialScreenCount = project.layouts[0].screens.length;
  writeFileSync(projectFile, JSON.stringify(project));
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  cpSync(join(dir, "assets/demo-logistics-app.png"), join(dir, "assets/template-only.png"));
  mkdirSync(join(dir, "templates"));
  writeFileSync(join(dir, "templates/promo-card.json"), JSON.stringify({
    id: "promo-card",
    name: "Promo card",
    description: "Reusable headline and accent layout",
    platform: "apple",
    device: "macos",
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#0F172A" },
    elements: [
      { id: "template-shot", type: "screenshot", x: 80, y: 380, width: 500, height: 900, rotation: 0, opacity: 1, locked: false, visible: true, assetUrl: "assets/template-only.png", fit: "cover", cornerRadius: 40 },
      { id: "template-title", type: "text", role: "heading", x: 60, y: 120, width: 540, height: 160, rotation: 0, opacity: 1, locked: false, visible: true, content: "Promo", fontFamily: "Pacifico", size: 64, weight: 400, lineHeight: 1.2, letterSpacing: 0, align: "center", color: "#FFFFFF" },
      { id: "template-accent", type: "shape", role: "accent", x: 60, y: 320, width: 540, height: 30, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#38BDF8", radius: 15 },
    ],
  }));
  writeFileSync(join(dir, "templates/windows-desktop.json"), JSON.stringify({
    id: "windows-desktop",
    name: "Windows desktop",
    description: "Incompatible project-local template from another destination.",
    platform: "windows",
    device: "desktop",
    artboard: { width: 1920, height: 1080 },
    background: { type: "solid", color: "#0F172A" },
    elements: [],
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

function project() {
  return JSON.parse(readFileSync(projectFile, "utf8"));
}

describe("template library UI", () => {
  it("creates, selects, persists, and reloads a template screen", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    await page.getByRole("button", { name: "Resources panel", exact: true }).click();
    const templatesButton = page.getByRole("button", { name: /Screen templates/ });
    await templatesButton.click();
    const templateDialog = page.getByRole("dialog", { name: "Screen template library" });
    await templateDialog.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await templateDialog.waitFor({ state: "hidden" });
    expect(await templatesButton.evaluate((node) => document.activeElement === node)).toBe(true);
    await templatesButton.click();
    const builtInRow = page.getByTestId("template-row-macos-starter");
    await builtInRow.waitFor({ state: "visible" });
    expect(await builtInRow.textContent()).toContain("App Store · macOS");
    expect(await page.getByTestId("template-row-tvos-starter").count()).toBe(0);
    expect(await page.getByTestId("template-row-visionos-starter").count()).toBe(0);
    expect(await page.getByTestId("template-row-wear-os-starter").count()).toBe(0);
    await builtInRow.getByRole("button", { name: "Create screen", exact: true }).click();
    await expect.poll(() => project().layouts[0].screens.length).toBe(initialScreenCount + 1);
    expect(project().layouts[0].screens.find((screen: { id: string }) => (
      screen.id === "macos-starter"
    ))).toMatchObject({
      name: "macOS",
      platform: "apple",
      device: "macos",
    });
    // A successful create closes the library; reopen it for the project-template source.
    await templateDialog.waitFor({ state: "hidden" });
    await templatesButton.click();
    await page.getByRole("group", { name: "Template source", exact: true })
      .getByRole("button", { name: "Project templates", exact: true }).click();
    const row = page.getByTestId("template-row-promo-card");
    await row.waitFor({ state: "visible" });
    expect(await page.getByTestId("template-row-windows-desktop").count()).toBe(0);
    let releaseCreate!: () => void;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    await page.route("**/api/templates", async (route) => {
      if (route.request().method() === "POST") await createGate;
      await route.continue();
    });
    await row.getByRole("button", { name: "Create screen", exact: true }).click();
    const closeButton = page.getByRole("button", { name: "Close screen template library", exact: true });
    const templateAssetLoaded = page.waitForResponse((response) =>
      response.url().includes("/api/asset?") && decodeURIComponent(response.url()).includes("assets/template-only.png"),
    );
    try {
      await page.getByRole("button", { name: "Creating…", exact: true }).waitFor();
      expect(await closeButton.isDisabled()).toBe(true);
      await page.getByRole("dialog", { name: "Screen template library" }).locator("..").click({ position: { x: 4, y: 4 } });
      expect(await page.getByRole("dialog", { name: "Screen template library" }).isVisible()).toBe(true);
    } finally {
      releaseCreate();
    }

    expect((await templateAssetLoaded).ok()).toBe(true);

    await expect.poll(() => project().layouts[0].screens.length).toBe(initialScreenCount + 2);
    const created = project().layouts[0].screens.find((screen: { id: string }) => (
      screen.id === "promo-card"
    ));
    expect(created).toMatchObject({ id: "promo-card", name: "Promo card", locale: "en" });
    expect(created.elements.map((element: { id: string }) => element.id))
      .not.toContain("template-title");

    await templateDialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Structure panel", exact: true }).click();
    const screenButton = page.getByRole("button", { name: /Promo card · macos/ });
    await screenButton.waitFor({ state: "visible" });
    expect(await screenButton.getAttribute("aria-current")).toBe("true");

    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("canvas");
    expect(await page.getByRole("button", { name: /Promo card · macos/ }).count()).toBe(1);
    await page.close();
  });
});
