// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixturePath = resolve(repoRoot, "fixtures/regressions/connected-canvas/app-store-screenshots.json");

let server: RunningServer;
let browser: Browser;
let directory: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "play-gallery-"));
  const projectPath = join(directory, "app-store-screenshots.json");
  copyFileSync(fixturePath, projectPath);
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

describe("play gallery", () => {
  it("plays the connected export group, pauses on manual navigation, and returns focus", async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.getByTestId("connected-artboards").locator("canvas").first().waitFor({ state: "visible" });

    const overview = page.getByRole("button", { name: "Overview", exact: true });
    const viewBefore = await overview.getAttribute("aria-pressed");
    const playButton = page.getByRole("navigation", { name: "Editor tools" }).getByRole("button", { name: "Play", exact: true });
    await playButton.click();
    const dialog = page.getByRole("dialog", { name: "Play" });
    await dialog.waitFor({ state: "visible" });

    const slides = dialog.locator("[data-play-slide]");
    const currentSlide = () => dialog.locator("[data-play-slide][aria-current='true']").getAttribute("aria-label");
    await expect.poll(() => slides.count()).toBe(2);
    expect(await slides.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label"))))
      .toEqual(["1 of 2: Connected First", "2 of 2: Connected Second"]);
    await expect.poll(() => slides.locator("canvas").count()).toBeGreaterThan(1);
    const box = await slides.first().boundingBox();
    expect(Math.abs(box!.width / box!.height - 660 / 1434)).toBeLessThan(0.01);

    // Autoplay advances once (~3 s) and stops on the last screen.
    await expect.poll(currentSlide, { timeout: 6_000 }).toBe("2 of 2: Connected Second");
    await dialog.getByRole("button", { name: "Start autoplay" }).waitFor();

    await page.keyboard.press("ArrowLeft");
    await expect.poll(currentSlide).toBe("1 of 2: Connected First");
    expect(await dialog.getByRole("button", { name: "Start autoplay" }).count()).toBe(1);

    await page.keyboard.press(" ");
    await dialog.getByRole("button", { name: "Pause autoplay" }).waitFor();
    await dialog.getByRole("button", { name: "Next screen" }).click();
    await expect.poll(currentSlide).toBe("2 of 2: Connected Second");
    expect(await dialog.getByRole("button", { name: "Start autoplay" }).count()).toBe(1);

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Play");
    expect(await overview.getAttribute("aria-pressed")).toBe(viewBefore);
    await page.close();
  });

  it("returns focus to Play when the click did not focus it and steps by wheel and drag", async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`${server.url}/editor`, { waitUntil: "load" });
    await page.getByTestId("connected-artboards").locator("canvas").first().waitFor({ state: "visible" });

    // A scripted click does not move focus, matching how Safari treats a clicked button.
    await page.getByRole("navigation", { name: "Editor tools" }).getByRole("button", { name: "Play", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    const dialog = page.getByRole("dialog", { name: "Play" });
    await dialog.waitFor({ state: "visible" });
    await expect.poll(() => dialog.locator("[data-play-slide] canvas").count()).toBeGreaterThan(1);

    const currentSlide = () => dialog.locator("[data-play-slide][aria-current='true']").getAttribute("aria-label");
    const gallery = dialog.getByTestId("play-gallery");
    const center = await gallery.boundingBox();
    await page.mouse.move(center!.x + center!.width / 2, center!.y + center!.height / 2);
    await page.mouse.wheel(0, 300);
    expect(await dialog.getByRole("button", { name: "Pause autoplay" }).count()).toBe(1);
    await page.mouse.wheel(300, 0);
    await dialog.getByRole("button", { name: "Start autoplay" }).waitFor();
    await expect.poll(currentSlide).toBe("2 of 2: Connected Second");

    await page.mouse.down();
    await page.mouse.move(center!.x + center!.width / 2 + 200, center!.y + center!.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(currentSlide).toBe("1 of 2: Connected First");

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Play");
    await page.close();
  });
});
