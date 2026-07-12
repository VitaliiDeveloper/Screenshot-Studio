// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

/**
 * Slice 5 behavioral gate: a toolbar insert and an inspector edit both round-trip through the
 * store + API route to the on-disk JSON. Runs against a temp copy so the fixture is untouched.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/phase-0-sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/phase-0-sample/assets");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "inspector-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeFileSync(projectFile, readFileSync(sample, "utf8"));
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
  process.env.PROJECT_PATH = projectFile;
  server = await startWebServer(3125);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  delete process.env.PROJECT_PATH;
  rmSync(dir, { recursive: true, force: true });
});

function elements(): Array<{ id: string; type: string; width: number; opacity: number }> {
  const p = JSON.parse(readFileSync(projectFile, "utf8"));
  return p.screens[0].elements;
}

describe("inspector + toolbar", () => {
  it("keeps the view switch centred and applies one compact toolbar breakpoint", async () => {
    const page = await browser.newPage({ viewport: { width: 828, height: 998 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    const viewSwitch = page.getByLabel("Canvas view");
    const focusLabel = page.getByRole("button", { name: "Focus" }).locator("span");
    const overviewLabel = page.getByRole("button", { name: "Overview" }).locator("span");
    const exportLabel = page.getByRole("button", { name: "Export" }).locator("span");
    const productName = page.getByText("Screenshot Studio", { exact: true });
    const projectName = page.getByText("Store Launch Demo", { exact: true });

    expect(await productName.isVisible()).toBe(true);
    expect(await projectName.isVisible()).toBe(false);
    expect(await focusLabel.isVisible()).toBe(false);
    expect(await overviewLabel.isVisible()).toBe(false);
    expect(await exportLabel.isVisible()).toBe(false);
    expect(await page.getByRole("button", { name: "Undo" }).isVisible()).toBe(false);
    expect(await page.getByRole("button", { name: "Redo" }).isVisible()).toBe(false);

    const compactBox = await viewSwitch.boundingBox();
    expect(compactBox).not.toBeNull();
    expect(compactBox!.x + compactBox!.width / 2).toBeCloseTo(828 / 2, 0);

    await page.setViewportSize({ width: 640, height: 900 });
    expect(await productName.isVisible()).toBe(false);

    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await productName.isVisible()).toBe(true);
    expect(await projectName.isVisible()).toBe(true);
    expect(await focusLabel.isVisible()).toBe(true);
    expect(await overviewLabel.isVisible()).toBe(true);
    expect(await exportLabel.isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Undo" }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Redo" }).isVisible()).toBe(true);

    const desktopBox = await viewSwitch.boundingBox();
    expect(desktopBox).not.toBeNull();
    expect(desktopBox!.x + desktopBox!.width / 2).toBeCloseTo(1440 / 2, 0);

    await page.close();
  });

  it("inserting a shape and editing its width persist to disk", async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    const before = elements().length;
    await page.getByRole("button", { name: "Add element" }).click();
    await page.getByRole("button", { name: "+ Shape" }).click();

    // The inserted shape is appended AND selected, so the inspector shows its Transform section.
    await expect.poll(() => elements().length, { timeout: 10_000 }).toBe(before + 1);
    const added = elements()[before]!;
    expect(added.type).toBe("shape");

    // Edit Width in the inspector; the debounced save (300 ms) must land the new value.
    const width = page.getByText("Width", { exact: true }).locator("xpath=following-sibling::input");
    await width.fill("321");
    await width.blur();
    await expect
      .poll(() => elements().find((e) => e.id === added.id)!.width, { timeout: 10_000 })
      .toBe(321);

    await page.close();
  });

  it("rejects invalid numeric drafts and flushes a valid edit on immediate reload", async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");
    await page.getByRole("button", { name: "Hero headline", exact: true }).click();
    const headline = elements().find((element) => element.id === "headline")!;
    const width = page.getByRole("spinbutton", { name: "Width", exact: true });
    const opacity = page.getByRole("spinbutton", { name: "Opacity", exact: true });

    await width.fill("0");
    await width.blur();
    expect(await width.inputValue()).toBe(String(headline.width));
    expect(elements().find((element) => element.id === "headline")!.width).toBe(headline.width);

    await opacity.fill("2");
    await opacity.blur();
    expect(await opacity.inputValue()).toBe(String(headline.opacity));
    expect(elements().find((element) => element.id === "headline")!.opacity).toBe(headline.opacity);

    await width.fill("333");
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("canvas");
    await expect.poll(() => elements().find((element) => element.id === "headline")!.width, { timeout: 10_000 }).toBe(333);
    await page.getByRole("button", { name: "Hero headline", exact: true }).click();
    expect(await page.getByRole("spinbutton", { name: "Width", exact: true }).inputValue()).toBe("333");
    await page.close();
  });

  it("surfaces persistence failures instead of leaving them silent", async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");
    await page.getByRole("button", { name: "Hero headline", exact: true }).click();
    await page.route("**/api/project", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "disk unavailable" }) });
      } else {
        await route.continue();
      }
    });
    const before = elements().find((element) => element.id === "headline")!.width;
    const width = page.getByRole("spinbutton", { name: "Width", exact: true });
    await width.fill(String(before + 1));
    await width.blur();
    const alert = page.getByRole("alert").filter({ hasText: "Save failed: disk unavailable" });
    await alert.waitFor({ state: "visible" });
    expect(elements().find((element) => element.id === "headline")!.width).toBe(before);
    await page.close();
  });
});
