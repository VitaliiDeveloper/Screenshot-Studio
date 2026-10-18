// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Locator } from "playwright";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";
import { createImageElement, createTextElement } from "@screenshot-studio/core/model";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

// Three explicit lines of 100 px text at line height 1.2 need exactly 360 px. A 240 px box drops
// the third line; Fit text must land on 66 (3 × 79.2 = 237.6) because 67 needs 241.2 px.
function stackedText(id: string, y: number, height: number) {
  return { ...createTextElement({ x: 100, y }), id, content: "A\nB\nC", size: 100, width: 1000, height };
}

function screen(id: string, name: string, locale: string, elements: unknown[] = []) {
  return {
    id,
    name,
    platform: "apple",
    device: "iphone",
    locale,
    direction: "ltr",
    artboard: { width: 1206, height: 2622 },
    background: { type: "solid", color: "#ffffff" },
    elements,
  };
}

// The 6.9" size of the de Hero slot. The slot lives in a later locale so the first locale has no
// 6.9" row for the missing-locale check to compare against.
function variant(id: string, root: string, elements: unknown[]) {
  return { ...screen(id, "Hero", "de", elements), artboard: { width: 1320, height: 2868 }, variantOf: root, storeTargetId: "6.9" };
}

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "editor-issues-"));
  projectPath = join(directory, "app-store-screenshots.json");
  mkdirSync(join(directory, "assets"));
  cpSync(resolve(repoRoot, "fixtures/sample/assets/demo-logistics-app.png"), join(directory, "assets", "replacement.png"));
  writeFileSync(projectPath, JSON.stringify({
    meta: { name: "Issues", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Default",
      mode: "isolated",
      screens: [
        screen("hero", "Hero", "en", [stackedText("clipped", 100, 240), stackedText("exact", 600, 360)]),
        screen("details", "Details", "en", [{ ...createImageElement({ assetUrl: "assets/lost.png" }), id: "lost" }]),
        screen("hero-de", "Hero", "de", [stackedText("de-title", 100, 240)]),
        variant("hero-de-69", "hero-de", [stackedText("de-title-69", 100, 240)]),
      ],
    }],
  }, null, 2));
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

function savedProject() {
  return JSON.parse(readFileSync(projectPath, "utf8"));
}

function savedElement(screenId: string, id: string) {
  return savedProject().layouts[0].screens.find((candidate: { id: string }) => candidate.id === screenId)
    .elements.find((element: { id: string }) => element.id === id);
}

function textSize(id: string, screenId = "hero"): number {
  return savedElement(screenId, id).size;
}

/** Pixels in the canvas close to the overflow stroke color (#F59E0B). */
function amberPixels(canvas: Locator): Promise<number> {
  return canvas.evaluate((node: HTMLCanvasElement) => {
    const data = node.getContext("2d")!.getImageData(0, 0, node.width, node.height).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      const [red, green, blue, alpha] = [data[index]!, data[index + 1]!, data[index + 2]!, data[index + 3]!];
      if (alpha > 200 && red > 200 && green > 120 && green < 190 && blue < 60) count += 1;
    }
    return count;
  });
}

describe("editor issues", () => {
  it("measures overflow through the shared renderer and applies every fix", async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });

    const issuesButton = page.getByRole("button", { name: "Issues: 2 blockers · 3 warnings" });
    await issuesButton.waitFor({ state: "visible" });
    await issuesButton.click();
    const dialog = page.getByRole("dialog", { name: "Issues" });
    await dialog.waitFor({ state: "visible" });
    expect(await dialog.getByRole("listitem").count()).toBe(5);
    expect(await dialog.getByText("Screen missing in locale de").isVisible()).toBe(true);
    expect(await dialog.getByText("Image missing from the project folder").isVisible()).toBe(true);

    await dialog.getByRole("button", { name: /^Go to Text · Hero · .* · en$/ }).click();
    await dialog.waitFor({ state: "detached" });

    // The canvas marks the same overflowing layer Issues reports. Go to selects it, so its fix
    // sits in the selection toolbar instead of the canvas hint.
    const heroStage = page.locator('[data-testid="editor-stage"][data-stage-screen-ids="hero"]');
    await expect.poll(() => heroStage.getAttribute("data-text-overflow-count")).toBe("1");
    // Parity captures the first (artwork) canvas; the amber marks live on their own layer above it.
    const canvases = heroStage.locator("canvas");
    await expect.poll(() => canvases.count()).toBe(2);
    await expect.poll(() => amberPixels(canvases.nth(1))).toBeGreaterThan(0);
    expect(await amberPixels(canvases.first())).toBe(0);
    const toolbar = heroStage.getByRole("toolbar", { name: "Selection actions" });
    await toolbar.waitFor({ state: "visible" });
    expect(await heroStage.getByRole("button", { name: /^Fit text: / }).count()).toBe(0);
    await toolbar.getByLabel("Selection color").fill("#ff0000");
    await expect.poll(() => savedElement("hero", "clipped").color).toBe("#ff0000");
    await toolbar.getByRole("button", { name: "Fit text" }).click();
    await expect.poll(() => textSize("clipped")).toBe(66);
    await page.getByRole("button", { name: "Undo" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => textSize("clipped")).toBe(100);
    await expect.poll(() => savedElement("hero", "clipped").color).not.toBe("#ff0000");

    // Without a selection the hint on the artboard offers the same fix.
    await page.getByTestId("canvas-viewport").click({ position: { x: 8, y: 240 } });
    await expect.poll(() => heroStage.getAttribute("data-selection-count")).toBe("0");
    await heroStage.getByRole("button", { name: "Fit text: Text" }).click();
    await expect.poll(() => textSize("clipped")).toBe(66);
    await expect.poll(() => heroStage.getAttribute("data-text-overflow-count")).toBe("0");
    expect(await heroStage.getByRole("button", { name: /^Fit text: / }).count()).toBe(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => textSize("clipped")).toBe(100);
    await expect.poll(() => heroStage.getAttribute("data-text-overflow-count")).toBe("1");

    await page.getByRole("button", { name: "Issues: 2 blockers · 3 warnings" }).click();

    await dialog.getByRole("button", { name: /^Fit text: .* · en$/ }).click();
    await expect.poll(() => textSize("clipped")).toBe(66);
    expect(textSize("exact")).toBe(100);
    await page.getByRole("button", { name: "Issues: 2 blockers · 2 warnings" }).waitFor({ state: "attached" });

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => textSize("clipped")).toBe(100);
    await page.getByRole("button", { name: "Redo" }).click();
    await expect.poll(() => textSize("clipped")).toBe(66);
    await page.getByRole("button", { name: "Issues: 2 blockers · 2 warnings" }).click();

    // Replace hands over to the existing media picker and leaves Issues closed.
    await dialog.getByRole("button", { name: /^Replace: assets\/lost\.png · Image · Details/ }).click();
    await dialog.waitFor({ state: "detached" });
    const picker = page.getByRole("dialog", { name: "Image asset picker" });
    await picker.getByRole("button", { name: "Use assets/replacement.png" }).click();
    await picker.waitFor({ state: "detached" });
    await expect.poll(() => savedElement("details", "lost").assetUrl).toBe("assets/replacement.png");
    await page.getByRole("button", { name: "Issues: 1 blocker · 2 warnings" }).click();

    await dialog.getByRole("button", { name: /^Create from en: Details/ }).click();
    await expect.poll(() => savedProject().layouts[0].screens
      .filter((candidate: { locale: string; storeTargetId?: string }) => candidate.locale === "de" && !candidate.storeTargetId)
      .map((candidate: { name: string }) => candidate.name)).toEqual(["Hero", "Details"]);
    await page.getByRole("button", { name: "Issues: 2 warnings" }).waitFor({ state: "attached" });

    // Status by size reads the same issues: Fit on another size changes only that size's layer.
    await dialog.getByRole("button", { name: /^Go to Text · Hero · iPhone 6\.3.* · de$/ }).click();
    await dialog.waitFor({ state: "detached" });
    const status = page.getByRole("list", { name: "Status by size" });
    await status.getByText(/^6\.9.* — text overflows$/).waitFor({ state: "visible" });
    expect(await status.getByText(/^6\.3.* — editing · text overflows$/).isVisible()).toBe(true);
    await status.getByRole("button", { name: /^Fit text on 6\.9/ }).click();
    await expect.poll(() => textSize("de-title-69", "hero-de-69")).toBe(66);
    expect(textSize("de-title", "hero-de")).toBe(100);
    await status.getByText(/^6\.9.* — fits$/).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => textSize("de-title-69", "hero-de-69")).toBe(100);
    await page.getByRole("button", { name: "Redo" }).click();
    await expect.poll(() => textSize("de-title-69", "hero-de-69")).toBe(66);

    await status.getByRole("button", { name: /^Fit text on 6\.3/ }).click();
    await expect.poll(() => textSize("de-title", "hero-de")).toBe(66);
    await page.getByRole("button", { name: "Issues: none" }).click();
    expect(await dialog.getByText("Nothing to fix in this layout.").isVisible()).toBe(true);

    await page.close();
  });
});
