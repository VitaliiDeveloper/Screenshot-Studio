// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
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
  directory = mkdtempSync(join(tmpdir(), "editor-history-"));
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

function bridgeX(): number {
  const project = JSON.parse(readFileSync(projectPath, "utf8"));
  return project.screens[0].elements.find((element: { id: string }) => element.id === "bridge").x;
}

describe("Phase 6 editor history", () => {
  it("persists toolbar and keyboard undo/redo for an owner-local connected drag", async () => {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const connected = page.getByTestId("connected-artboards");
    await connected.waitFor({ state: "visible" });

    const undo = page.getByRole("button", { name: "Undo" });
    const redo = page.getByRole("button", { name: "Redo" });
    expect(await undo.isDisabled()).toBe(true);
    expect(await redo.isDisabled()).toBe(true);

    const canvas = connected.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    const scale = box.width / 1320;
    const x = box.x + 700 * scale;
    const y = box.y + 300 * scale;
    await page.mouse.click(x, y);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60 * scale, y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(bridgeX).toBeCloseTo(620, 0);
    await expect.poll(() => undo.isEnabled()).toBe(true);

    await undo.click();
    await expect.poll(bridgeX).toBe(560);
    await expect.poll(() => redo.isEnabled()).toBe(true);

    await redo.click();
    await expect.poll(bridgeX).toBeCloseTo(620, 0);
    await page.keyboard.press("Control+z");
    await expect.poll(bridgeX).toBe(560);
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(bridgeX).toBeCloseTo(620, 0);

    await page.reload({ waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });
    expect(await page.getByRole("button", { name: "Undo" }).isDisabled()).toBe(true);
    expect(await page.getByRole("button", { name: "Redo" }).isDisabled()).toBe(true);

    await page.close();
  });
});
