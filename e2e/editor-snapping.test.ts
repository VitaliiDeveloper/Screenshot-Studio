// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/regressions/connected-canvas/app-store-screenshots.json");

let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "editor-snapping-"));
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

async function beginBridgeDrag(page: Page, logicalDeltaX: number) {
  const connected = page.getByTestId("connected-artboards");
  const canvas = connected.locator("canvas").first();
  const box = (await canvas.boundingBox())!;
  const scale = box.width / 1320;
  const x = box.x + 650 * scale;
  const y = box.y + 300 * scale;
  await page.mouse.click(x, y);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + logicalDeltaX * scale, y, { steps: 8 });
  return { connected, scale };
}

describe("Phase 6 editor snapping", () => {
  it("uses a zoom-correct threshold and ephemeral connected-space guide", async () => {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    const connected = page.getByTestId("connected-artboards");
    await connected.waitFor({ state: "visible" });

    const zoomControls = page.getByLabel("Zoom controls");
    const zoomValue = zoomControls.getByRole("button").nth(1);
    await zoomValue.click();
    await expect.poll(() => zoomValue.textContent()).toBe("100%");

    let drag = await beginBridgeDrag(page, -108);
    const stage = drag.connected.getByTestId("editor-stage");
    expect(await stage.getAttribute("data-snap-guide-x")).toBeNull();
    await page.mouse.up();
    await expect.poll(bridgeX).toBeCloseTo(452, 0);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(bridgeX).toBe(560);

    const zoomOut = zoomControls.getByRole("button", { name: "Zoom out" });
    for (const value of ["90%", "80%", "70%", "60%", "50%"]) {
      await zoomOut.click();
      await expect.poll(() => zoomValue.textContent()).toBe(value);
    }

    drag = await beginBridgeDrag(page, -108);
    await expect.poll(() => (
      drag.connected.getByTestId("editor-stage").getAttribute("data-snap-guide-x")
    )).toBe("660");
    await page.mouse.up();
    await expect.poll(bridgeX).toBe(460);
    expect(await stage.getAttribute("data-snap-guide-x")).toBeNull();

    await page.reload({ waitUntil: "load" });
    await page.getByTestId("connected-artboards").waitFor({ state: "visible" });
    expect(await page.getByTestId("connected-artboards").getByTestId("editor-stage")
      .getAttribute("data-snap-guide-x")).toBeNull();

    await page.close();
  });
});
