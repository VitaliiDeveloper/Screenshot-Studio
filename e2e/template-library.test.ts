import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/phase-0-sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/phase-0-sample/assets");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;
let initialScreenCount: number;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "template-library-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  const project = JSON.parse(readFileSync(sample, "utf8"));
  initialScreenCount = project.screens.length;
  writeFileSync(projectFile, JSON.stringify(project));
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  mkdirSync(join(dir, "templates"));
  writeFileSync(join(dir, "templates/promo-card.json"), JSON.stringify({
    id: "promo-card",
    name: "Promo card",
    description: "Reusable headline and accent layout",
    platform: "apple",
    device: "iphone",
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#0F172A" },
    elements: [
      { id: "template-title", type: "text", role: "heading", x: 60, y: 120, width: 540, height: 160, rotation: 0, opacity: 1, locked: false, visible: true, content: "Promo", fontFamily: "Pacifico", size: 64, weight: 400, lineHeight: 1.2, letterSpacing: 0, align: "center", color: "#FFFFFF" },
      { id: "template-accent", type: "shape", role: "accent", x: 60, y: 320, width: 540, height: 30, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#38BDF8", radius: 15 },
    ],
  }));
  process.env.PROJECT_PATH = projectFile;
  server = await startWebServer(3134);
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

    await page.getByRole("button", { name: "Templates", exact: true }).click();
    const row = page.getByTestId("template-row-promo-card");
    await row.waitFor({ state: "visible" });
    await row.getByRole("button", { name: "Create screen", exact: true }).click();

    await expect.poll(() => project().screens.length).toBe(initialScreenCount + 1);
    const created = project().screens.at(-1);
    expect(created).toMatchObject({ id: "promo-card", name: "Promo card", locale: "en" });
    expect(created.elements.map((element: { id: string }) => element.id))
      .not.toContain("template-title");

    await page.getByRole("button", { name: "Close template library", exact: true }).click();
    const screenButton = page.getByRole("button", { name: /Promo card · iphone/ });
    await screenButton.waitFor({ state: "visible" });
    expect(await screenButton.getAttribute("class")).toContain("text-blue-700");

    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("canvas");
    expect(await page.getByRole("button", { name: /Promo card · iphone/ }).count()).toBe(1);
    await page.close();
  });
});
