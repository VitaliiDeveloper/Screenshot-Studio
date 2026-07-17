// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sampleRoot = join(repoRoot, "fixtures", "sample");
const sampleProject = join(sampleRoot, "app-store-screenshots.json");

let directory: string;
let projectPath: string;
let server: RunningServer;
let browser: Browser;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "accessibility-e2e-"));
  projectPath = join(directory, "app-store-screenshots.json");
  await writeFile(projectPath, await readFile(sampleProject));
  await cp(join(sampleRoot, "assets"), join(directory, "assets"), { recursive: true });
  server = await startWebServer(undefined, {
    projectPath,
    storeSpecsPath: resolve(repoRoot, "store-specs.json"),
  });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function openEditor(viewport: { width: number; height: number }): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`${server.url}/editor`, { waitUntil: "load" });
  await page.waitForSelector("canvas");
  const canvasViewport = page.getByTestId("canvas-viewport");
  await expect.poll(
    () => canvasViewport.getAttribute("data-initial-reveal"),
    { timeout: 10_000 },
  ).toBe("idle");
  return { context, page };
}

async function openPanel(page: Page, name: "Add panel" | "Structure panel"): Promise<void> {
  if (name === "Add panel") {
    await openPanel(page, "Structure panel");
    await page.getByRole("button", { name: "Add element", exact: true }).click();
    return;
  }
  const button = page.getByRole("button", { name, exact: true });
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
}

async function expectNoSeriousOrCriticalViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blockers = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      nodes: violation.nodes.map((node) => ({
        html: node.html,
        summary: node.failureSummary,
        targets: node.target.map(String),
      })),
    }));
  expect(blockers, `${state}: ${JSON.stringify(blockers, null, 2)}`).toEqual([]);
}

describe("editor accessibility states", () => {
  it("has no serious or critical violations across desktop shell, panels, menus, dialogs, and alerts", async () => {
    const { context, page } = await openEditor({ width: 1440, height: 1000 });
    await expectNoSeriousOrCriticalViolations(page, "desktop shell");

    await openPanel(page, "Structure panel");
    await page.getByRole("heading", { name: "Structure", exact: true }).waitFor();
    await expectNoSeriousOrCriticalViolations(page, "desktop structure panel");

    await openPanel(page, "Add panel");
    await page.getByRole("heading", { name: "Add", exact: true }).waitFor();
    await expectNoSeriousOrCriticalViolations(page, "desktop add panel");

    await page.getByRole("button", { name: "Canvas background: Dots", exact: true }).click();
    const canvasMenu = page.getByRole("menu", { name: "Canvas background", exact: true });
    await canvasMenu.waitFor();
    await canvasMenu.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    await expectNoSeriousOrCriticalViolations(page, "desktop canvas menu");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Manage locales", exact: true }).click();
    await page.getByRole("dialog", { name: "Locale manager", exact: true }).waitFor();
    await expectNoSeriousOrCriticalViolations(page, "desktop locale dialog");
    await page.getByRole("button", { name: "Close locale manager", exact: true }).click();

    await openPanel(page, "Structure panel");
    await page.getByRole("button", { name: "Hero headline", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Width", exact: true }).waitFor();
    await expectNoSeriousOrCriticalViolations(page, "desktop inspector form");

    await page.route("**/api/project", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "audit save failure" }),
        });
      } else {
        await route.continue();
      }
    });
    const width = page.getByRole("spinbutton", { name: "Width", exact: true });
    await width.fill("331");
    await width.blur();
    await page.getByRole("alert").filter({ hasText: "Save failed: audit save failure" }).waitFor();
    await expectNoSeriousOrCriticalViolations(page, "desktop save failure alert");
    await context.close();
  });

  it("has no serious or critical violations in compact shell, panel, and dialog states", async () => {
    const { context, page } = await openEditor({ width: 760, height: 900 });
    await expectNoSeriousOrCriticalViolations(page, "compact shell");

    await openPanel(page, "Add panel");
    await page.getByRole("heading", { name: "Add", exact: true }).waitFor();
    await expectNoSeriousOrCriticalViolations(page, "compact add panel");

    await page.getByRole("button", { name: "Manage locales", exact: true }).click();
    await page.getByRole("dialog", { name: "Locale manager", exact: true }).waitFor();
    await expectNoSeriousOrCriticalViolations(page, "compact locale dialog");
    await context.close();
  });
});
