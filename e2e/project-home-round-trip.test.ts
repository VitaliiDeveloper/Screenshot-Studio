// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "playwright";
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Project } from "@screenshot-studio/core/model";
import { startWebServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = resolve(repoRoot, "fixtures/sample");
let browser: Browser;
let directory: string;
let projectRoot: string;
let projectName: string;
let managedDataRoot: string;
let inheritedProjectPath: string | undefined;
let inheritedDataRoot: string | undefined;

function prepareProject(): void {
  projectRoot = join(directory, "project");
  mkdirSync(projectRoot, { recursive: true });
  copyFileSync(
    join(fixtureRoot, "app-store-screenshots.json"),
    join(projectRoot, "app-store-screenshots.json"),
  );
  cpSync(join(fixtureRoot, "assets"), join(projectRoot, "assets"), { recursive: true });

  const projectPath = join(projectRoot, "app-store-screenshots.json");
  const project = JSON.parse(readFileSync(projectPath, "utf8")) as Project;
  projectName = project.meta.name;
  const source = project.layouts[0]!;
  project.layouts.push({
    ...structuredClone(source),
    id: "secondary",
    name: "Secondary",
    screens: source.screens
      .filter((screen) => screen.variantOf === undefined)
      .slice(0, 2)
      .map((screen) => ({
        ...structuredClone(screen),
        id: `secondary-${screen.id}`,
        elements: screen.elements.map((element) => ({
          ...structuredClone(element),
          id: `secondary-${element.id}`,
        })),
      })),
  });
  writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);
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
      nodes: violation.nodes.map((node) => ({
        html: node.html,
        targets: node.target.map(String),
      })),
    }));
  expect(blockers, `${state}: ${JSON.stringify(blockers, null, 2)}`).toEqual([]);
}

beforeAll(async () => {
  inheritedProjectPath = process.env.PROJECT_PATH;
  inheritedDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  delete process.env.PROJECT_PATH;
  directory = mkdtempSync(join(tmpdir(), "project-home-round-trip-"));
  managedDataRoot = join(directory, "managed-data");
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = managedDataRoot;
  prepareProject();
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

describe("Project Info and Workspace round trip", () => {
  it("preserves editor context, fences unsaved navigation, and closes only the active session", async () => {
    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "load" });
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await page.getByLabel("Choose project folder").setInputFiles(projectRoot);
      const initialImportResponsePending = page.waitForResponse("**/api/project-import", {
        timeout: 60_000,
      });
      await page.getByRole("button", { name: "Import managed copy" }).click();
      const initialImportResponse = await initialImportResponsePending;
      expect(initialImportResponse.status(), await initialImportResponse.text()).toBe(201);

      await page.waitForURL(`${server.url}/editor/**`);
      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await page.waitForURL(`${server.url}/`);
      const importedCard = page.getByRole("listitem").filter({ hasText: projectName });
      await importedCard.getByLabel(`More actions for ${projectName}`).click();
      await importedCard.getByRole("button", { name: "Project details", exact: true }).click();
      await page.waitForURL(/\/home\?project=(project_[a-f0-9]{32})&entry=\1$/u);
      await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
      expect(await page.getByText("Managed project", { exact: true }).count()).toBe(1);
      expect(await page.getByText(join(projectRoot, "app-store-screenshots.json"), { exact: true }).count()).toBe(0);
      expect(await page.getByText(/\(lead\)/u).count()).toBe(0);
      const firstPreview = page.locator('section[aria-labelledby="project-screens"] img').first();
      await firstPreview.evaluate((image) => new Promise<void>((resolve) => {
        if ((image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0) resolve();
        else image.addEventListener("load", () => resolve(), { once: true });
      }));
      const previewDensity = await firstPreview.evaluate((element) => {
        const image = element as HTMLImageElement;
        const bounds = image.getBoundingClientRect();
        const sourceRatio = image.naturalWidth / image.naturalHeight;
        const renderedWidth = Math.min(bounds.width, bounds.height * sourceRatio);
        const renderedHeight = Math.min(bounds.height, bounds.width / sourceRatio);
        return {
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          requiredWidth: renderedWidth * window.devicePixelRatio,
          requiredHeight: renderedHeight * window.devicePixelRatio,
        };
      });
      expect(previewDensity.naturalWidth).toBeGreaterThanOrEqual(Math.floor(previewDensity.requiredWidth) - 1);
      expect(previewDensity.naturalHeight).toBeGreaterThanOrEqual(Math.floor(previewDensity.requiredHeight) - 1);
      await expectNoSeriousOrCriticalViolations(page, "Project Info");

      await page.getByRole("link", { name: "Open in Editor", exact: true }).click();
      await page.waitForURL(`${server.url}/editor/**`);
      await page.waitForSelector("canvas");
      await page.getByRole("button", { name: "Active layout: Default" }).click();
      await page.getByRole("menuitemradio", { name: /Secondary/ }).click();
      await page.getByRole("button", { name: "Save Fast · iPhone", exact: true }).click();
      const selectedLayer = page.getByRole("button", { name: "Save fast headline", exact: true });
      await selectedLayer.click();
      await page.getByRole("button", { name: "Focus", exact: true }).click();

      await page.route("**/api/project", async (route) => {
        if (route.request().method() === "PUT") {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "round-trip save failure" }),
          });
        } else {
          await route.continue();
        }
      });
      const width = page.getByRole("spinbutton", { name: "Width", exact: true });
      await width.fill("333");
      await width.blur();
      await page.getByRole("alert").filter({ hasText: "Save failed: round-trip save failure" }).waitFor();
      await page.getByRole("button", { name: "Projects", exact: true }).click();
      const saveFailureDialog = page.getByRole("dialog", { name: "Project could not be saved" });
      await saveFailureDialog.getByRole("heading", { name: "Project could not be saved", exact: true }).waitFor();
      await saveFailureDialog.getByRole("button").filter({ hasText: "Stay in editor" }).click();
      expect(new URL(page.url()).pathname).toMatch(/^\/editor\/[^/]+$/u);

      await page.unroute("**/api/project");
      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await page.waitForURL(`${server.url}/`);
      await page.getByRole("button", {
        name: `Open ${projectName} in Workspace`,
        exact: true,
      }).click();
      await page.waitForURL(`${server.url}/editor/**`);
      await page.waitForSelector("canvas");

      expect(await page.getByRole("button", { name: "Active layout: Secondary" }).count()).toBe(1);
      expect(await page.getByRole("button", { name: "Focus", exact: true }).getAttribute("aria-pressed"))
        .toBe("true");
      const reopenedScreen = page.getByRole("button", { name: "Save Fast · iPhone", exact: true });
      expect(await reopenedScreen.count()).toBe(1);
      await reopenedScreen.click();
      const reopenedLayer = page.getByRole("button", { name: "Save fast headline", exact: true });
      await reopenedLayer.click();
      expect(await reopenedLayer.getAttribute("aria-pressed")).toBe("true");
      expect(await page.getByRole("spinbutton", { name: "Width", exact: true }).inputValue()).toBe("333");

      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await page.waitForURL(`${server.url}/`);
      const detailsCard = page.getByRole("listitem").filter({ hasText: projectName });
      await detailsCard.getByLabel(`More actions for ${projectName}`).click();
      await detailsCard.getByRole("button", { name: "Project details", exact: true }).click();
      await page.waitForURL(/\/home\?project=(project_[a-f0-9]{32})&entry=\1$/u);
      const catalogPath = join(managedDataRoot, "catalog.json");
      const catalogBeforeClose = readFileSync(catalogPath, "utf8");
      const [{ id: managedProjectId }] = (JSON.parse(catalogBeforeClose) as {
        entries: Array<{ id: string }>;
      }).entries;
      const managedProjectPath = join(
        managedDataRoot,
        "projects",
        managedProjectId!,
        "app-store-screenshots.json",
      );
      const projectBeforeClose = readFileSync(managedProjectPath, "utf8");

      await page.getByLabel("Project info actions").click();
      await page.getByRole("button", { name: /Close project/u }).click();
      await page.waitForURL(`${server.url}/?switch=1`);
      await page.getByRole("heading", { name: "Recent projects" }).waitFor();
      expect(await page.evaluate(async () => (await fetch("/api/project-session", { cache: "no-store" })).status))
        .toBe(204);
      expect(readFileSync(catalogPath, "utf8")).toBe(catalogBeforeClose);
      expect(readFileSync(managedProjectPath, "utf8")).toBe(projectBeforeClose);
      await expectNoSeriousOrCriticalViolations(page, "App Home after Close project");
    } finally {
      await context.close();
      await server.stop();
    }
  });

  it("closes an imported replacement without saving the previously loaded workspace", async () => {
    process.env.SCREENSHOT_STUDIO_DATA_ROOT = join(directory, "replacement-managed-data");
    const originalRoot = join(directory, "replacement-source-project");
    mkdirSync(originalRoot, { recursive: true });
    copyFileSync(
      join(fixtureRoot, "app-store-screenshots.json"),
      join(originalRoot, "app-store-screenshots.json"),
    );
    cpSync(join(fixtureRoot, "assets"), join(originalRoot, "assets"), { recursive: true });
    const replacementRoot = join(directory, "replacement-project");
    cpSync(originalRoot, replacementRoot, { recursive: true });
    const replacementPath = join(replacementRoot, "app-store-screenshots.json");
    const replacement = JSON.parse(readFileSync(replacementPath, "utf8")) as Project;
    replacement.meta.name = "Replacement project";
    writeFileSync(replacementPath, `${JSON.stringify(replacement, null, 2)}\n`);

    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const page = await context.newPage();
      await page.goto(`${server.url}/?switch=1`, { waitUntil: "load" });
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await page.getByLabel("Choose project folder").setInputFiles(originalRoot);
      const firstImportResponsePending = page.waitForResponse("**/api/project-import", {
        timeout: 60_000,
      });
      await page.getByRole("button", { name: "Import managed copy" }).click();
      const firstImportResponse = await firstImportResponsePending;
      expect(firstImportResponse.status(), await firstImportResponse.text()).toBe(201);
      await page.waitForURL(`${server.url}/editor/**`);
      await page.waitForSelector("canvas");
      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await page.waitForURL(`${server.url}/`);
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await page.getByLabel("Choose project folder").setInputFiles(replacementRoot);
      const replacementImportResponsePending = page.waitForResponse("**/api/project-import", {
        timeout: 60_000,
      });
      await page.getByRole("button", { name: "Import managed copy" }).click();
      const replacementImportResponse = await replacementImportResponsePending;
      expect(replacementImportResponse.status(), await replacementImportResponse.text()).toBe(201);
      await page.waitForURL(`${server.url}/editor/**`);
      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await page.waitForURL(`${server.url}/`);
      const replacementCard = page.getByRole("listitem").filter({ hasText: replacement.meta.name });
      await replacementCard.getByLabel(`More actions for ${replacement.meta.name}`).click();
      const projectHomeSessionPending = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/project-session");
      const projectHomeProjectPending = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/project");
      await replacementCard.getByRole("button", { name: "Project details", exact: true }).click();
      await page.waitForURL(/\/home\?project=(project_[a-f0-9]{32})&entry=\1$/u);
      const [projectHomeSessionResponse, projectHomeProjectResponse] = await Promise.all([
        projectHomeSessionPending,
        projectHomeProjectPending,
      ]);
      expect(projectHomeSessionResponse.status()).toBe(200);
      expect(projectHomeProjectResponse.status()).toBe(200);
      await page.getByLabel("Project info actions").click();
      await page.getByRole("button", { name: /Close project/u }).click();
      await page.waitForURL(`${server.url}/?switch=1`);
      expect(await page.evaluate(async () => (
        await fetch("/api/project-session", { cache: "no-store" })
      ).status)).toBe(204);
    } finally {
      await context.close();
      await server.stop();
    }
  });
});
