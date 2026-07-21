// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let browser: Browser;
let directory: string;
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
  directory = mkdtempSync(join(tmpdir(), "launcher-closure-"));
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = join(directory, "managed-data");
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

describe("Projects and Workspace closure journey", () => {
  it("creates into Workspace, returns through the bottom rail, and reopens from the gallery", async () => {
    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "load" });

      await page.getByRole("heading", {
        name: "Turn product moments into store-ready stories.",
        exact: true,
      }).waitFor();
      await expectNoSeriousOrCriticalViolations(page, "Projects first run");
      expect(await page.getByRole("button", { name: "New project", exact: true }).count()).toBe(1);
      expect(await page.getByRole("button", { name: "Import", exact: true }).count()).toBe(1);
      expect(await page.getByRole("button", { name: /Capture/u }).count()).toBe(0);

      await page.getByRole("button", { name: "New project", exact: true }).click();
      const creationDialog = page.getByRole("dialog", { name: "Create a managed project" });
      await creationDialog.getByLabel("Project name").fill("Product launch story");
      await creationDialog.getByRole("radio", { name: /Product launch/u }).check();
      const creationResponsePromise = page.waitForResponse("**/api/project-create", {
        timeout: 60_000,
      });
      await creationDialog.getByRole("button", { name: "Create project", exact: true }).click();
      const creationResponse = await creationResponsePromise;
      expect(
        creationResponse.status(),
        `Creation response: ${await creationResponse.text()}`,
      ).toBe(201);

      await page.waitForURL(`${server.url}/editor`);
      await page.waitForSelector("canvas");
      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await page.waitForURL(`${server.url}/`);

      const card = page.getByRole("listitem").filter({ hasText: "Product launch story" });
      await card.getByRole("button", {
        name: "Open Product launch story in Workspace",
        exact: true,
      }).waitFor();
      const cardPreview = card.locator("img").first();
      await cardPreview.waitFor();
      await expect.poll(() => cardPreview.getAttribute("src")).toMatch(/^data:image\/png/u);
      await expectNoSeriousOrCriticalViolations(page, "Populated Projects gallery");
      expect(await card.getByText(/screens/u).count()).toBeGreaterThan(0);
      expect(await card.getByText(/layout/u).count()).toBeGreaterThan(0);
      expect(await card.getByRole("button", { name: "Remove from recents" }).count()).toBe(0);

      await card.getByLabel("More actions for Product launch story").click();
      await card.getByRole("button", { name: "Project details", exact: true }).click();
      await page.waitForURL(/\/home\?project=project_[a-f0-9]{32}$/u);
      await page.getByRole("heading", { name: "Product launch story", exact: true }).waitFor();
      await page.getByRole("link", { name: "Continue in Workspace", exact: true }).click();
      await page.waitForURL(`${server.url}/editor`);

      await page.setViewportSize({ width: 640, height: 900 });
      const projectsButton = page.getByRole("button", { name: "Projects", exact: true });
      await projectsButton.waitFor();
      expect(await projectsButton.isVisible()).toBe(true);
      await projectsButton.click();
      await page.waitForURL(`${server.url}/`);

      const reopenedCard = page.getByRole("listitem").filter({ hasText: "Product launch story" });
      await reopenedCard.getByRole("button", {
        name: "Open Product launch story in Workspace",
        exact: true,
      }).click();
      await page.waitForURL(`${server.url}/editor`);
      await page.waitForSelector("canvas");
    } finally {
      await context.close();
      await server.stop();
    }
  });
});
