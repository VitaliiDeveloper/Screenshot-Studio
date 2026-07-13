// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/phase-6-connected/app-store-screenshots.json");

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "connected-workspace-"));
  projectPath = join(directory, "app-store-screenshots.json");
  writeFileSync(projectPath, readFileSync(fixturePath));
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

function project() {
  return JSON.parse(readFileSync(projectPath, "utf8"));
}

function bridgeX(): number {
  return project().screens.find((screen: { id: string }) => screen.id === "connected-first")
    .elements.find((element: { id: string }) => element.id === "bridge").x;
}

async function dragBridge(page: Page, logicalDeltaX: number) {
  const canvas = page.getByTestId("connected-artboards").locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  const scale = box.width / 1320;
  const x = box.x + 700 * scale;
  const y = box.y + 300 * scale;
  await page.mouse.click(x, y);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + logicalDeltaX * scale, y, { steps: 8 });
  await page.mouse.up();
}

describe("Phase 6 connected workspace hardening", () => {
  it("keeps group scope, owner surfaces, thumbnails, history, snapping, and mode guard coherent", async () => {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const connected = page.getByTestId("connected-artboards");
    await connected.waitFor({ state: "visible" });
    const previewTitles = connected.getByTestId("artboard-preview-label");
    const previewMetadata = connected.getByTestId("artboard-preview-caption");
    expect(await previewTitles.allTextContents()).toEqual(["Connected First", "Connected Second"]);
    expect(await previewMetadata.allTextContents()).toEqual(["iphone · en", "iphone · en"]);
    const stage = connected.getByTestId("editor-stage");
    expect(await stage.getAttribute("data-stage-screen-ids"))
      .toBe("connected-first connected-second");

    const screens = page.getByRole("list", { name: "Screens for en iphone group" });
    await screens.waitFor({ state: "visible" });
    expect(await screens.getByRole("listitem").count()).toBe(2);
    expect(await page.getByRole("button", { name: "Unrelated · phone", exact: true }).count()).toBe(0);

    const mode = page.getByRole("button", { name: "Canvas mode: connected" });
    expect(await page.getByRole("button", { name: "Undo" }).isDisabled()).toBe(true);
    await mode.click();
    const modeError = page.getByRole("alert").filter({ hasText: "Can't switch to isolated canvas yet" });
    await expect.poll(() => modeError.textContent(), { timeout: 5_000 }).toContain("screen boundaries");
    expect(project().mode).toBe("connected");
    expect(await page.getByRole("button", { name: "Undo" }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Dismiss canvas mode error" }).click();

    const secondButton = screens.getByRole("button", { name: "Connected Second · iphone" });
    const secondThumbnail = secondButton.locator("xpath=..").locator("img");
    const originalThumbnail = await secondThumbnail.getAttribute("src");
    expect(originalThumbnail).toMatch(/^data:image\/png/);

    await dragBridge(page, 60);
    await expect.poll(bridgeX).toBeCloseTo(620, 0);
    await expect.poll(() => secondThumbnail.getAttribute("src")).not.toBe(originalThumbnail);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(bridgeX).toBe(560);
    await expect.poll(() => secondThumbnail.getAttribute("src")).toBe(originalThumbnail);

    await dragBridge(page, -160);
    await expect.poll(() => Math.abs(bridgeX() - 400) < 2).toBe(true);
    await mode.click();
    await expect.poll(() => project().mode).toBe("isolated");
    const isolatedMode = page.getByRole("button", { name: "Canvas mode: isolated" });
    await expect.poll(() => isolatedMode.count()).toBe(1);
    await expect.poll(() => page.getByTestId("connected-artboards").count()).toBe(0);

    await isolatedMode.click();
    const connectedModeDialog = page.getByRole("dialog", { name: "Switch to connected canvas?" });
    await connectedModeDialog.waitFor({ state: "visible" });
    expect(project().mode).toBe("isolated");
    await connectedModeDialog.getByRole("button", { name: "Switch to connected", exact: true }).click();
    await expect.poll(() => project().mode).toBe("connected");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => project().mode).toBe("isolated");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => project().mode).toBe("connected");
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(bridgeX).toBe(560);

    await secondButton.click();
    await expect.poll(() => secondButton.getAttribute("aria-current")).toBe("true");
    await expect.poll(() => stage.getAttribute("data-active-screen-id")).toBe("connected-second");
    await expect.poll(() => page.getByTestId("layers-owner").textContent()).toBe("Connected Second");
    expect(await page.getByRole("list", { name: "Layers for Connected Second" })
      .getByRole("listitem").count()).toBe(1);

    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const stageBox = (await stage.boundingBox())!;
    const connectedBox = (await connected.boundingBox())!;
    const viewportBox = (await page.getByTestId("canvas-viewport").boundingBox())!;
    expect(stageBox.x).toBeGreaterThanOrEqual(viewportBox.x);
    expect(stageBox.x + stageBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width);
    expect(connectedBox.y).toBeGreaterThanOrEqual(viewportBox.y);
    expect(connectedBox.y + connectedBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);

    await page.close();
  });

  it("keeps compact overlays and mode feedback keyboard-operable", async () => {
    const page = await browser.newPage({ viewport: { width: 720, height: 900 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });
    const structure = page.getByRole("button", { name: "Structure panel", exact: true });
    const inspect = page.getByRole("button", { name: "Inspect", exact: true });
    expect(await structure.getAttribute("aria-pressed")).toBe("false");
    expect(await inspect.getAttribute("aria-pressed")).toBe("false");

    const mode = page.getByRole("button", { name: "Canvas mode: connected" });
    await mode.focus();
    await page.keyboard.press("Enter");
    const modeError = page.getByRole("alert").filter({ hasText: "Can't switch to isolated canvas yet" });
    await modeError.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await expect.poll(() => modeError.count()).toBe(0);
    expect(await mode.evaluate((node) => document.activeElement === node)).toBe(true);

    await structure.focus();
    await page.keyboard.press("Space");
    await expect.poll(() => structure.getAttribute("aria-pressed")).toBe("true");
    expect(await inspect.getAttribute("aria-pressed")).toBe("false");
    await page.getByRole("list", { name: "Screens for en iphone group" }).waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await expect.poll(() => structure.getAttribute("aria-pressed")).toBe("false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.close();
  });
});
