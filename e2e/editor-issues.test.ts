// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";
import { createTextElement } from "@screenshot-studio/core/model";

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
    artboard: { width: 1320, height: 2868 },
    background: { type: "solid", color: "#ffffff" },
    elements,
  };
}

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "editor-issues-"));
  projectPath = join(directory, "app-store-screenshots.json");
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
        screen("details", "Details", "en"),
        screen("hero-de", "Hero", "de"),
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

function textSize(id: string): number {
  return savedProject().layouts[0].screens[0].elements.find((element: { id: string }) => element.id === id).size;
}

describe("editor issues", () => {
  it("measures overflow through the shared renderer and applies both fixes", async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });

    const issuesButton = page.getByRole("button", { name: "Issues: 1 blocker · 1 warning" });
    await issuesButton.waitFor({ state: "visible" });
    await issuesButton.click();
    const dialog = page.getByRole("dialog", { name: "Issues" });
    await dialog.waitFor({ state: "visible" });
    expect(await dialog.getByRole("listitem").count()).toBe(2);
    expect(await dialog.getByText("Screen missing in locale de").isVisible()).toBe(true);

    await dialog.getByRole("button", { name: /^Go to Text · Hero/ }).click();
    await dialog.waitFor({ state: "detached" });
    await issuesButton.click();

    await dialog.getByRole("button", { name: /^Fit text: / }).click();
    await expect.poll(() => textSize("clipped")).toBe(66);
    expect(textSize("exact")).toBe(100);
    await page.getByRole("button", { name: "Issues: 1 blocker" }).waitFor({ state: "attached" });

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => textSize("clipped")).toBe(100);
    await page.getByRole("button", { name: "Redo" }).click();
    await expect.poll(() => textSize("clipped")).toBe(66);
    await page.getByRole("button", { name: "Issues: 1 blocker" }).click();

    await dialog.getByRole("button", { name: /^Create from en: Details/ }).click();
    await expect.poll(() => savedProject().layouts[0].screens
      .filter((candidate: { locale: string }) => candidate.locale === "de")
      .map((candidate: { name: string }) => candidate.name)).toEqual(["Hero", "Details"]);
    await page.getByRole("button", { name: "Issues: none" }).waitFor({ state: "attached" });
    expect(await dialog.getByText("Nothing to fix in this layout.").isVisible()).toBe(true);

    await page.close();
  });
});
