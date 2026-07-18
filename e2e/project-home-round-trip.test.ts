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
import { startWebServer } from "../packages/cli/src/server.js";

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

describe("Project Home and Workspace round trip", () => {
  it("preserves editor context, fences unsaved navigation, and closes only the active session", async () => {
    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "load" });
      await page.getByRole("button", { name: "Import project" }).click();
      await page.getByLabel("Choose project folder").setInputFiles(projectRoot);
      await page.getByRole("button", { name: "Import managed copy" }).click();

      await page.waitForURL(`${server.url}/home`);
      await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
      expect(await page.getByText("Managed browser project", { exact: true }).count()).toBe(1);
      expect(await page.getByText(join(projectRoot, "app-store-screenshots.json"), { exact: true }).count()).toBe(0);
      await expectNoSeriousOrCriticalViolations(page, "Project Home");

      await page.getByRole("link", { name: "Continue in Workspace", exact: true }).click();
      await page.waitForURL(`${server.url}/editor`);
      await page.waitForSelector("canvas");
      await page.getByRole("button", { name: "Active layout: Default" }).click();
      await page.getByRole("menuitemradio", { name: /Secondary/ }).click();
      await page.getByRole("button", { name: "Save Fast · iphone", exact: true }).click();
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
      await page.getByRole("button", { name: "Project Home", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Project Home was not opened" }).waitFor();
      expect(new URL(page.url()).pathname).toBe("/editor");

      await page.unroute("**/api/project");
      await page.getByRole("button", { name: "Project Home", exact: true }).click();
      await page.waitForURL(`${server.url}/home`);
      await page.getByRole("link", { name: "Continue in Workspace", exact: true }).click();
      await page.waitForURL(`${server.url}/editor`);
      await page.waitForSelector("canvas");

      expect(await page.getByRole("button", { name: "Active layout: Secondary" }).count()).toBe(1);
      expect(await page.getByRole("button", { name: "Focus", exact: true }).getAttribute("aria-pressed"))
        .toBe("true");
      expect(await page.getByRole("button", { name: "Save Fast · iphone", exact: true }).getAttribute("aria-current"))
        .toBe("true");
      expect(await page.getByRole("button", { name: "Save fast headline", exact: true }).getAttribute("class"))
        .toContain("font-semibold");
      expect(await page.getByRole("spinbutton", { name: "Width", exact: true }).inputValue()).toBe("333");

      await page.getByRole("button", { name: "Project Home", exact: true }).click();
      await page.waitForURL(`${server.url}/home`);
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

      await page.getByRole("button", { name: "Close project", exact: true }).click();
      await page.waitForURL(`${server.url}/?switch=1`);
      await page.getByRole("heading", { name: "Turn product moments into store-ready stories." }).waitFor();
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
    const replacementRoot = join(directory, "replacement-project");
    cpSync(projectRoot, replacementRoot, { recursive: true });
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
      await page.getByRole("button", { name: "Import project" }).click();
      await page.getByLabel("Choose project folder").setInputFiles(projectRoot);
      await page.getByRole("button", { name: "Import managed copy" }).click();
      await page.waitForURL(`${server.url}/home`);

      await page.getByRole("link", { name: "Continue in Workspace", exact: true }).click();
      await page.waitForURL(`${server.url}/editor`);
      await page.waitForSelector("canvas");
      await page.getByRole("button", { name: "Project Home", exact: true }).click();
      await page.waitForURL(`${server.url}/home`);

      await page.getByRole("link", { name: "Import another project", exact: true }).click();
      await page.waitForURL(`${server.url}/?switch=1`);
      await page.getByRole("button", { name: "Import project" }).click();
      await page.getByLabel("Choose project folder").setInputFiles(replacementRoot);
      await page.getByRole("button", { name: "Import managed copy" }).click();
      await page.waitForURL(`${server.url}/home`);
      await page.getByRole("heading", { name: replacement.meta.name, exact: true }).waitFor();

      await page.getByRole("button", { name: "Close project", exact: true }).click();
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
