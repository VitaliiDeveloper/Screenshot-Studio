// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Project } from "@screenshot-studio/core/model";
import { startWebServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let browser: Browser;
let directory: string;
let managedDataRoot: string;
let inheritedProjectPath: string | undefined;
let inheritedDataRoot: string | undefined;

async function expectNoSeriousOrCriticalViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blockers = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.map(({ html, target }) => ({ html, targets: target.map(String) })),
    }));
  expect(blockers, `${state}: ${JSON.stringify(blockers, null, 2)}`).toEqual([]);
}

beforeAll(async () => {
  inheritedProjectPath = process.env.PROJECT_PATH;
  inheritedDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  delete process.env.PROJECT_PATH;
  directory = mkdtempSync(join(tmpdir(), "project-creation-"));
  managedDataRoot = join(directory, "managed-data");
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = managedDataRoot;
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (inheritedProjectPath === undefined) delete process.env.PROJECT_PATH;
  else process.env.PROJECT_PATH = inheritedProjectPath;
  if (inheritedDataRoot === undefined) delete process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  else process.env.SCREENSHOT_STUDIO_DATA_ROOT = inheritedDataRoot;
  rmSync(directory, { recursive: true, force: true });
});

describe("managed project creation", () => {
  it("creates empty and starter projects, preserves retry focus, and activates only the new project", async () => {
    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    let context: BrowserContext | undefined;
    let releasePublication: (() => void) | undefined;
    try {
      context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "load" });
      await page.getByRole("heading", {
        name: "Turn product moments into store-ready stories.",
      }).waitFor({ timeout: 10_000 }).catch(async (error: unknown) => {
        throw new Error(`App Home did not render at ${page.url()}: ${await page.locator("body").innerText()}`, {
          cause: error,
        });
      });
      const createTrigger = page.getByRole("button", { name: "Create project" });
      await createTrigger.click();
      let dialog = page.getByRole("dialog", { name: "Create a managed project" });
      await dialog.waitFor();
      const dialogHeading = dialog.getByRole("heading", { name: "Create a managed project" });
      expect(await dialogHeading.evaluate((element) => element === document.activeElement)).toBe(true);
      await expectNoSeriousOrCriticalViolations(page, "Create project dialog");

      await dialog.getByLabel("Target platform").selectOption("windows");
      expect(await dialog.getByRole("radio", { name: /Product launch/ }).isDisabled()).toBe(true);
      expect(await dialog.getByRole("radio", { name: /Feature focus/ }).isEnabled()).toBe(true);
      await page.keyboard.press("Shift+Tab");
      expect(await dialog.getByRole("button", { name: "Create project", exact: true }).evaluate(
        (element) => element === document.activeElement,
      )).toBe(true);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      expect(await createTrigger.evaluate((element) => element === document.activeElement)).toBe(true);

      await createTrigger.click();
      dialog = page.getByRole("dialog", { name: "Create a managed project" });
      await dialog.getByLabel("Project name").fill("Empty desktop story");
      await dialog.getByLabel("Target platform").selectOption("windows");
      await dialog.getByRole("radio", { name: /Connected/ }).check();
      await dialog.getByRole("button", { name: "Create project", exact: true }).click();
      await page.waitForURL(`${server.url}/home`);
      await page.getByRole("heading", { name: "Empty desktop story", exact: true }).waitFor();

      await page.getByRole("link", { name: "Import another project", exact: true }).click();
      await page.waitForURL(`${server.url}/?switch=1`);
      await page.getByRole("button", { name: "Create project" }).click();
      dialog = page.getByRole("dialog", { name: "Create a managed project" });
      const nameInput = dialog.getByLabel("Project name");
      await nameInput.fill("Launch sequence");
      await dialog.getByLabel("Target platform").selectOption("apple");
      await dialog.getByRole("radio", { name: /Product launch/ }).check();

      let attempt = 0;
      const publicationGate = new Promise<void>((resolveGate) => { releasePublication = resolveGate; });
      await page.route("**/api/project-create", async (route) => {
        attempt += 1;
        if (attempt === 1) {
          await route.fulfill({
            status: 422,
            contentType: "application/json",
            body: JSON.stringify({ error: "Starter validation failed", code: "invalid-scaffold" }),
          });
          return;
        }
        await publicationGate;
        await route.continue();
      });

      await dialog.getByRole("button", { name: "Create project", exact: true }).click();
      await dialog.getByRole("alert").waitFor();
      await nameInput.focus();
      await nameInput.press("End");
      await nameInput.pressSequentially(" retry");
      expect(await nameInput.evaluate((element) => element === document.activeElement)).toBe(true);

      await dialog.getByRole("button", { name: "Create project", exact: true }).click();
      await dialog.getByRole("status").waitFor();
      await page.keyboard.press("Tab");
      expect(await dialogHeading.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.press("Escape");
      expect(await dialog.isVisible()).toBe(true);
      releasePublication();
      releasePublication = undefined;

      await page.waitForURL(`${server.url}/home`);
      await page.getByRole("heading", { name: "Launch sequence retry", exact: true }).waitFor();
      const active = await page.evaluate(async () => {
        const response = await fetch("/api/project-session", { cache: "no-store" });
        return {
          descriptor: await response.json() as { name: string; sessionId: string },
          projectId: response.headers.get("x-project-id"),
        };
      });
      expect(active.descriptor.name).toBe("Launch sequence retry");

      const catalog = JSON.parse(readFileSync(join(managedDataRoot, "catalog.json"), "utf8")) as {
        entries: Array<{ id: string; name: string }>;
      };
      expect(catalog.entries.map(({ name }) => name).sort()).toEqual([
        "Empty desktop story",
        "Launch sequence retry",
      ]);
      expect(active.projectId).toBe(
        catalog.entries.find(({ name }) => name === "Launch sequence retry")?.id,
      );
      for (const entry of catalog.entries) {
        const project = JSON.parse(readFileSync(join(
          managedDataRoot,
          "projects",
          entry.id,
          "app-store-screenshots.json",
        ), "utf8")) as Project;
        if (entry.name === "Empty desktop story") {
          expect(project.layouts[0]).toMatchObject({ mode: "connected" });
          expect(project.layouts[0]!.screens).toHaveLength(1);
          expect(project.layouts[0]!.screens[0]).toMatchObject({ platform: "windows", elements: [] });
        } else {
          expect(project.layouts[0]!.screens).toHaveLength(3);
          expect(project.layouts[0]!.screens.every((screen) => screen.platform === "apple")).toBe(true);
          expect(project.layouts[0]!.screens.some((screen) => screen.elements.length > 0)).toBe(true);
        }
      }
    } finally {
      releasePublication?.();
      await Promise.all([
        context?.close() ?? Promise.resolve(),
        server.stop(),
      ]);
    }
  });
});
