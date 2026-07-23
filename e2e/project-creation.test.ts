// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Project } from "@screenshot-studio/core/model";
import { startWebServer } from "@screenshot-studio/cli/server";

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

async function selectTargetPlatform(dialog: Locator, name: string): Promise<void> {
  await dialog.getByRole("button", { name: "Target platform" }).click();
  const menu = dialog.getByRole("menu", { name: "Target platform options" });
  await menu.getByRole("menuitemradio", { name }).click();
}

async function selectDeviceFamily(dialog: Locator, name: string): Promise<void> {
  await dialog.getByRole("button", { name: "Device family" }).click();
  const menu = dialog.getByRole("menu", { name: "Device family options" });
  await menu.getByRole("menuitemradio", { name }).click();
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
  it("creates empty and starter projects, recovers activation, and preserves retry focus", async () => {
    let server = await startWebServer(undefined, {
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
      const createTrigger = page.getByRole("button", { name: "New project" });
      await createTrigger.click();
      let dialog = page.getByRole("dialog", { name: "Create a managed project" });
      await dialog.waitFor();
      const dialogHeading = dialog.getByRole("heading", { name: "Create a managed project" });
      expect(await dialogHeading.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.waitForTimeout(250);
      await expectNoSeriousOrCriticalViolations(page, "Create project dialog");

      const platformTrigger = dialog.getByRole("button", { name: "Target platform" });
      await platformTrigger.click();
      await dialog.getByRole("menuitemradio", { name: "Apple App Store" }).press("Escape");
      expect(await dialog.isVisible()).toBe(true);
      await expect.poll(() => platformTrigger.evaluate(
        (element) => element === document.activeElement,
      )).toBe(true);

      await selectTargetPlatform(dialog, "Microsoft Store");
      expect(await dialog.getByRole("radio", { name: /Product launch/ }).count()).toBe(0);
      expect(await dialog.getByRole("radio", { name: /Feature focus/ }).isEnabled()).toBe(true);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      expect(await createTrigger.evaluate((element) => element === document.activeElement)).toBe(true);

      await createTrigger.click();
      dialog = page.getByRole("dialog", { name: "Create a managed project" });
      await dialog.getByLabel("Project name").fill("Empty desktop story");
      await selectTargetPlatform(dialog, "Microsoft Store");
      await selectDeviceFamily(dialog, "Xbox");
      await dialog.getByRole("radio", { name: /Connected/ }).check();
      await dialog.getByRole("button", { name: "Create project", exact: true }).click();
      await page.waitForURL(`${server.url}/editor`);
      let onboarding = page.getByTestId("first-screen-onboarding");
      await onboarding.getByRole("heading", { name: "Your blank screen is ready" }).waitFor();
      expect(await onboarding.getByText(/create a new editable screen from a built-in template/).count()).toBe(1);
      await onboarding.getByRole("button", { name: "Import capture folder", exact: true }).click();
      const captureDialog = page.getByRole("dialog", { name: "Capture import" });
      await captureDialog.waitFor();
      expect(page.url()).toBe(`${server.url}/editor`);
      await captureDialog.getByRole("button", { name: "Close capture import", exact: true }).click();
      onboarding = page.getByTestId("first-screen-onboarding");
      await onboarding.getByRole("button", { name: "Keep blank screen", exact: true }).click();
      await onboarding.waitFor({ state: "detached" });
      await page.goto(`${server.url}/home`, { waitUntil: "load" });
      await page.getByRole("heading", { name: "Empty desktop story", exact: true }).waitFor();

      await server.stop();
      server = await startWebServer(undefined, {
        storeSpecsPath: resolve(repoRoot, "store-specs.json"),
      });
      await page.goto(`${server.url}/home`, { waitUntil: "load" });
      await page.getByRole("heading", { name: "Empty desktop story", exact: true }).waitFor();
      const recoveredCatalog = JSON.parse(
        readFileSync(join(managedDataRoot, "catalog.json"), "utf8"),
      ) as { entries: Array<{ name: string }> };
      expect(recoveredCatalog.entries.map(({ name }) => name)).toEqual(["Empty desktop story"]);

      await page.getByRole("link", { name: "Projects", exact: true }).click();
      await page.waitForURL(`${server.url}/`);
      await page.getByRole("button", { name: "New project" }).click();
      dialog = page.getByRole("dialog", { name: "Create a managed project" });
      const nameInput = dialog.getByLabel("Project name");
      await nameInput.fill("Launch sequence");
      await selectTargetPlatform(dialog, "Apple App Store");
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

      const submitButton = dialog.getByRole("button", { name: "Create project", exact: true });
      await submitButton.scrollIntoViewIfNeeded();
      const dialogBody = dialog.locator(":scope > div").last();
      const scrollTopBeforePublication = await dialogBody.evaluate((element) => element.scrollTop);
      const dialogBeforePublication = await dialog.boundingBox();
      const formBeforePublication = await dialog.locator("form").boundingBox();
      const submitBeforePublication = await submitButton.boundingBox();
      expect(dialogBeforePublication).not.toBeNull();
      expect(formBeforePublication).not.toBeNull();
      expect(submitBeforePublication).not.toBeNull();

      await submitButton.click();
      expect(await dialog.getByText("Creating your project…", { exact: true }).count()).toBe(0);
      const scrollTopDuringPublication = await dialogBody.evaluate((element) => element.scrollTop);
      const dialogDuringPublication = await dialog.boundingBox();
      const formDuringPublication = await dialog.locator("form").boundingBox();
      const submitDuringPublication = await dialog.getByRole("button", {
        name: "Creating project…",
        exact: true,
      }).boundingBox();
      expect(formDuringPublication).not.toBeNull();
      expect(submitDuringPublication).not.toBeNull();
      expect(dialogDuringPublication).toMatchObject({
        x: dialogBeforePublication!.x,
        y: dialogBeforePublication!.y,
        width: dialogBeforePublication!.width,
        height: dialogBeforePublication!.height,
      });
      expect(Math.abs(scrollTopDuringPublication - scrollTopBeforePublication))
        .toBeLessThanOrEqual(2);
      expect(Math.abs(submitDuringPublication!.y - submitBeforePublication!.y))
        .toBeLessThanOrEqual(2);
      expect(Math.abs(formDuringPublication!.y - formBeforePublication!.y))
        .toBeLessThanOrEqual(2);
      await page.waitForTimeout(650);
      expect(await dialog.getByText("Creating your project…", { exact: true }).count()).toBe(0);
      await page.keyboard.press("Tab");
      expect(await dialogHeading.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.press("Escape");
      expect(await dialog.isVisible()).toBe(true);
      releasePublication();
      releasePublication = undefined;

      await page.waitForURL(`${server.url}/editor`);
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
          expect(project.layouts[0]!.screens[0]).toMatchObject({
            platform: "windows",
            device: "xbox",
            artboard: { width: 1920, height: 1080 },
            elements: [],
          });
        } else {
          expect(project.layouts[0]!.screens).toHaveLength(3);
          expect(project.layouts[0]!.screens.every((screen) => screen.platform === "apple")).toBe(true);
          expect(project.layouts[0]!.screens.some((screen) => screen.elements.length > 0)).toBe(true);
        }
      }

      await page.unroute("**/api/project-create");
      await page.goto(`${server.url}/home`, { waitUntil: "load" });
      await page.getByRole("heading", { name: "Launch sequence retry", exact: true }).waitFor();
      await page.getByRole("link", { name: "Projects", exact: true }).click();
      await page.waitForURL(`${server.url}/`);
      await page.getByRole("button", { name: "New project" }).click();
      dialog = page.getByRole("dialog", { name: "Create a managed project" });
      await dialog.getByLabel("Project name").fill("Built-in iPhone story");
      await selectTargetPlatform(dialog, "Apple App Store");
      await dialog.getByRole("radio", { name: /^iPhone\b/ }).check();
      await dialog.getByRole("button", { name: "Create project", exact: true }).click();
      await page.waitForURL(`${server.url}/editor`);
      await page.getByRole("button", { name: "Editable headline", exact: true }).waitFor();
      expect(await page.getByTestId("first-screen-onboarding").count()).toBe(0);

      const starterCatalog = JSON.parse(
        readFileSync(join(managedDataRoot, "catalog.json"), "utf8"),
      ) as { entries: Array<{ id: string; name: string }> };
      expect(starterCatalog.entries.map(({ name }) => name).sort()).toEqual([
        "Built-in iPhone story",
        "Empty desktop story",
        "Launch sequence retry",
      ]);
      const starterEntry = starterCatalog.entries.find(({ name }) => name === "Built-in iPhone story");
      expect(starterEntry).toBeDefined();
      const starterProject = JSON.parse(readFileSync(join(
        managedDataRoot,
        "projects",
        starterEntry!.id,
        "app-store-screenshots.json",
      ), "utf8")) as Project;
      expect(starterProject.layouts[0]!.screens).toHaveLength(1);
      expect(starterProject.layouts[0]!.screens[0]).toMatchObject({
        platform: "apple",
        device: "iphone",
        artboard: { width: 1320, height: 2868 },
      });
      expect(starterProject.layouts[0]!.screens[0]!.storeTargetId).toBeUndefined();
      expect(starterProject.layouts[0]!.screens[0]!.elements).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Editable headline", role: "heading" }),
        expect.objectContaining({ name: "Accent panel", role: "accent" }),
      ]));
    } finally {
      releasePublication?.();
      await Promise.all([
        context?.close() ?? Promise.resolve(),
        server.stop(),
      ]);
    }
  });
});
