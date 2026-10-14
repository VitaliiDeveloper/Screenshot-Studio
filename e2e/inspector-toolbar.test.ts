// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

/**
 * Slice 5 behavioral gate: a toolbar insert and an inspector edit both round-trip through the
 * store + API route to the on-disk JSON. Runs against a temp copy so the fixture is untouched.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sample = resolve(repoRoot, "fixtures/sample/app-store-screenshots.json");
const sampleAssets = resolve(repoRoot, "fixtures/sample/assets");

let server: RunningServer;
let browser: Browser;
let dir: string;
let projectFile: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "inspector-e2e-"));
  projectFile = join(dir, "app-store-screenshots.json");
  writeFileSync(projectFile, readFileSync(sample, "utf8"));
  cpSync(sampleAssets, join(dir, "assets"), { recursive: true });
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

function elements(): Array<{
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}> {
  const p = JSON.parse(readFileSync(projectFile, "utf8"));
  return p.layouts[0].screens[0].elements;
}

describe("inspector + toolbar", () => {
  it("centres the view switch when content fits and falls back without overlap", async () => {
    const page = await browser.newPage({ viewport: { width: 828, height: 998 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");

    const toolbar = page.locator("header", { has: page.getByLabel("Canvas view") });
    expect(await toolbar.getAttribute("data-density-ready")).toBe("true");
    expect(await toolbar.evaluate((element) => getComputedStyle(element).visibility)).toBe("visible");

    const focusLabel = page.getByRole("button", { name: "Focus" }).locator("span");
    const overviewLabel = page.getByRole("button", { name: "Overview" }).locator("span");
    const exportLabel = page.getByRole("button", { name: "Export" }).locator("span");
    const productName = page.getByText("Screenshot Studio", { exact: true });
    const projectName = page.getByText("Store Launch Demo", { exact: true });

    expect(await productName.isVisible()).toBe(false);
    expect(await projectName.isVisible()).toBe(false);
    expect(await focusLabel.isVisible()).toBe(false);
    expect(await overviewLabel.isVisible()).toBe(false);
    expect(await exportLabel.isVisible()).toBe(false);
    expect(await page.getByRole("button", { name: "Undo" }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Redo" }).isVisible()).toBe(true);

    const measureToolbar = async () => {
      return page.locator("header", { has: page.getByLabel("Canvas view") }).evaluate((header) => {
        const left = header.firstElementChild!.getBoundingClientRect();
        const center = header.querySelector('[aria-label="Canvas view"]')!.getBoundingClientRect();
        const right = header.querySelector('[aria-label="Export"]')!.parentElement!.getBoundingClientRect();
        return {
          viewportCenter: window.innerWidth / 2,
          leftRight: left.right,
          centerLeft: center.left,
          center: center.left + center.width / 2,
          centerRight: center.right,
          availableCenter: left.right + (right.left - left.right) / 2,
          rightLeft: right.left,
        };
      });
    };

    const expectNoOverlap = async (width: number) => {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(async () => {
        const geometry = await measureToolbar();
        return Math.min(
          geometry.centerLeft - geometry.leftRight,
          geometry.rightLeft - geometry.centerRight,
        );
      }).toBeGreaterThanOrEqual(0);
    };

    await expectNoOverlap(320);
    await page.getByRole("button", { name: "More toolbar actions" }).click();
    const overflowMenu = page.getByRole("menu", { name: "More toolbar actions" });
    expect(await overflowMenu.getByRole("menuitem", { name: "Undo" }).isVisible()).toBe(true);
    expect(await overflowMenu.getByRole("menuitem", { name: "Redo" }).isVisible()).toBe(true);
    await page.keyboard.press("Escape");
    const layoutSelector = page.getByRole("button", { name: "Active layout: Default" });
    await layoutSelector.click();
    await page.getByRole("menu", { name: "Design layouts" }).waitFor({ state: "visible" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expectNoOverlap(828);

    await page.setViewportSize({ width: 640, height: 900 });
    expect(await productName.isVisible()).toBe(false);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect.poll(() => productName.isVisible()).toBe(true);
    expect(await projectName.isVisible()).toBe(true);
    expect(await focusLabel.isVisible()).toBe(true);
    expect(await overviewLabel.isVisible()).toBe(true);
    expect(await exportLabel.isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Undo" }).isVisible()).toBe(true);
    expect(await page.getByRole("button", { name: "Redo" }).isVisible()).toBe(true);

    for (const width of [630, 959, 1024, 1100, 1152, 1280, 1440]) {
      await expectNoOverlap(width);
    }

    for (const width of [630, 828, 959, 1152, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(async () => {
        const geometry = await measureToolbar();
        return geometry.center - geometry.viewportCenter;
      }).toBeCloseTo(0, 0);
    }

    await page.setViewportSize({ width: 630, height: 900 });
    const localeMetrics = await page.getByRole("button", { name: "Active locale: en" }).evaluate((trigger) => {
      const label = trigger.querySelector("span")!;
      return { text: label.textContent, clipped: label.scrollWidth > label.clientWidth };
    });
    expect(localeMetrics).toEqual({ text: "en", clipped: false });

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
    const width = page.getByRole("spinbutton", { name: "Width", exact: true });
    await width.fill("321");
    await width.blur();
    await expect
      .poll(() => elements().find((e) => e.id === added.id)!.width, { timeout: 10_000 })
      .toBe(321);

    await page.close();
  });

  it("persists product-oriented transform controls", async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");
    await page.getByRole("button", { name: "Hero headline", exact: true }).click();
    const selectedId = "headline";

    const opacity = page.getByRole("slider", { name: "Opacity", exact: true });
    await opacity.fill("65");
    await opacity.blur();
    await expect.poll(() => elements().find((item) => item.id === selectedId)!.opacity).toBe(0.65);

    const lock = page.getByRole("button", { name: "Lock aspect ratio", exact: true });
    if ((await lock.getAttribute("aria-pressed")) !== "true") await lock.click();
    const beforeResize = elements().find((item) => item.id === selectedId)!;
    const width = page.getByRole("spinbutton", { name: "Width", exact: true });
    await width.fill(String(beforeResize.width / 2));
    await width.blur();
    await expect.poll(() => elements().find((item) => item.id === selectedId)!.height)
      .toBeCloseTo(beforeResize.height / 2, 2);

    const beforePosition = elements().find((item) => item.id === selectedId)!;
    const position = page.getByRole("button", { name: "Element position preview", exact: true });
    const positionBox = await position.boundingBox();
    expect(positionBox).not.toBeNull();
    await page.mouse.move(
      positionBox!.x + positionBox!.width * 0.7,
      positionBox!.y + positionBox!.height * 0.6,
    );
    await page.mouse.down();
    await page.mouse.move(
      positionBox!.x + positionBox!.width * 0.72,
      positionBox!.y + positionBox!.height * 0.62,
    );
    await page.mouse.up();
    await expect.poll(() => {
      const current = elements().find((item) => item.id === selectedId)!;
      return current.x !== beforePosition.x && current.y !== beforePosition.y;
    }).toBe(true);

    const rotation = page.getByRole("button", { name: "Rotation dial", exact: true });
    const rotationInput = page.getByRole("spinbutton", { name: "Rotation", exact: true });
    const beforeRotation = elements().find((item) => item.id === selectedId)!.rotation;
    await rotation.focus();
    await rotation.press("ArrowRight");
    await rotation.blur();
    await expect.poll(() => elements().find((item) => item.id === selectedId)!.rotation)
      .toBe(beforeRotation + 1);

    await rotationInput.fill("360");
    await rotationInput.blur();
    await expect.poll(() => elements().find((item) => item.id === selectedId)!.rotation).toBe(360);
    await rotation.focus();
    await rotation.press("ArrowRight");
    await expect.poll(() => elements().find((item) => item.id === selectedId)!.rotation).toBe(1);

    await rotationInput.fill("0");
    await rotationInput.blur();
    await expect.poll(() => elements().find((item) => item.id === selectedId)!.rotation).toBe(0);
    await rotation.focus();
    await rotation.press("ArrowLeft");
    await expect.poll(() => elements().find((item) => item.id === selectedId)!.rotation).toBe(359);
    await rotation.press("Shift+ArrowRight");
    await rotation.blur();
    await expect.poll(() => elements().find((item) => item.id === selectedId)!.rotation).toBe(9);

    await rotationInput.fill("-6");
    expect(await rotationInput.getAttribute("aria-invalid")).toBe("true");
    await rotationInput.blur();
    expect(await rotationInput.inputValue()).toBe("9");
    expect(elements().find((item) => item.id === selectedId)!.rotation).toBe(9);

    const rotationBox = await rotation.boundingBox();
    expect(rotationBox).not.toBeNull();
    await page.mouse.move(rotationBox!.x + rotationBox!.width / 2, rotationBox!.y + 1);
    await page.mouse.down();
    await page.mouse.move(rotationBox!.x + rotationBox!.width - 1, rotationBox!.y + rotationBox!.height / 2);
    await page.mouse.up();
    await expect.poll(() => elements().find((item) => item.id === selectedId)!.rotation).toBe(90);

    const persisted = elements().find((item) => item.id === selectedId)!;
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("canvas");
    await expect.poll(() => elements().find((item) => item.id === selectedId)).toMatchObject({
      x: persisted.x,
      y: persisted.y,
      width: persisted.width,
      height: persisted.height,
      rotation: persisted.rotation,
      opacity: 0.65,
    });
    await page.close();
  });

  it("rejects invalid numeric drafts and flushes a valid edit on immediate reload", async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.waitForSelector("canvas");
    await page.getByRole("button", { name: "Hero headline", exact: true }).click();
    const headline = elements().find((element) => element.id === "headline")!;
    const width = page.getByRole("spinbutton", { name: "Width", exact: true });
    const opacity = page.getByRole("spinbutton", { name: "Opacity value", exact: true });

    await width.fill("0");
    await width.blur();
    expect(await width.inputValue()).toBe(String(headline.width));
    expect(elements().find((element) => element.id === "headline")!.width).toBe(headline.width);

    await opacity.fill("200");
    await opacity.blur();
    expect(await opacity.inputValue()).toBe(String(headline.opacity * 100));
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
