// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import {
  cpSync,
  existsSync,
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
let remainingProjectRoot: string;
let managedDataRoot: string;
let inheritedProjectPath: string | undefined;
let inheritedDataRoot: string | undefined;

beforeAll(async () => {
  inheritedProjectPath = process.env.PROJECT_PATH;
  inheritedDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  delete process.env.PROJECT_PATH;
  directory = mkdtempSync(join(tmpdir(), "permanent-project-deletion-"));
  projectRoot = join(directory, "source-project");
  remainingProjectRoot = join(directory, "remaining-source-project");
  managedDataRoot = join(directory, "managed-data");
  mkdirSync(projectRoot, { recursive: true });
  cpSync(fixtureRoot, projectRoot, { recursive: true });
  cpSync(fixtureRoot, remainingProjectRoot, { recursive: true });
  const remainingProjectFile = join(remainingProjectRoot, "app-store-screenshots.json");
  const remainingProject = JSON.parse(readFileSync(remainingProjectFile, "utf8")) as Project;
  remainingProject.meta.name = "Remaining project";
  writeFileSync(remainingProjectFile, JSON.stringify(remainingProject));
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

describe("Permanent managed-project deletion", () => {
  it("closes the dialog and keeps the Projects screen interactive without a stale session", async () => {
    const sourceProjectPath = join(projectRoot, "app-store-screenshots.json");
    const sourceBefore = readFileSync(sourceProjectPath, "utf8");
    const remainingSourcePath = join(remainingProjectRoot, "app-store-screenshots.json");
    const remainingSourceBefore = readFileSync(remainingSourcePath, "utf8");
    const project = JSON.parse(sourceBefore) as Project;
    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      let deletionRequests = 0;
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (request.method() === "POST" && url.pathname === "/api/project-delete") {
          deletionRequests += 1;
        }
      });

      await page.goto(server.url, { waitUntil: "load" });
      await page.getByRole("button", { name: /^Import/ }).click();
      await page.getByLabel("Choose project folder").setInputFiles(projectRoot);
      await page.getByRole("button", { name: "Import managed copy" }).click();
      await page.waitForURL(`${server.url}/editor`, { waitUntil: "domcontentloaded" });

      await page.goto(`${server.url}/home`, { waitUntil: "load" });
      const projectInfoActions = page.locator("details").filter({
        has: page.getByLabel("Project info actions", { exact: true }),
      });
      await projectInfoActions.getByLabel("Project info actions", { exact: true }).click();
      await expect.poll(() => projectInfoActions.evaluate((element) => element.hasAttribute("open")))
        .toBe(true);
      await projectInfoActions.getByRole("button", { name: /Close project/u }).click();
      await page.waitForURL((url) => url.pathname === "/", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /^Import/ }).click();
      await page.getByLabel("Choose project folder").setInputFiles(remainingProjectRoot);
      await page.getByRole("button", { name: "Import managed copy" }).click();
      await page.waitForURL(`${server.url}/editor`, { waitUntil: "domcontentloaded" });

      await page.goto(`${server.url}/home`, { waitUntil: "load" });
      await projectInfoActions.getByLabel("Project info actions", { exact: true }).click();
      await expect.poll(() => projectInfoActions.evaluate((element) => element.hasAttribute("open")))
        .toBe(true);
      await projectInfoActions.getByRole("button", { name: /Close project/u }).click();
      await page.waitForURL((url) => url.pathname === "/", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", {
        name: "Open Remaining project in Workspace",
      }).waitFor();
      await page.getByLabel("More actions for Remaining project").click();

      const catalogPath = join(managedDataRoot, "catalog.json");
      const catalogBeforeDeletion = JSON.parse(readFileSync(catalogPath, "utf8")) as {
        entries: Array<{ id: string; name: string }>;
      };
      const managedProjectId = catalogBeforeDeletion.entries.find(
        (entry) => entry.name === "Remaining project",
      )?.id;
      expect(managedProjectId).toBeTruthy();
      const managedProjectDirectory = join(managedDataRoot, "projects", managedProjectId!);
      const quickDeleteTrigger = page.getByRole("button", {
        name: "Delete project…",
        exact: true,
      });

      await quickDeleteTrigger.click();
      const dialog = page.getByRole("dialog", { name: "Permanently delete project" });
      await dialog.waitFor();
      const downloadPromise = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Export archive, then continue" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("screenshot-studio-project.zip");

      const confirmation = dialog.getByLabel("Type Remaining project to confirm");
      const acknowledgement = dialog.getByLabel("I understand this project cannot be recovered.");
      const confirmDelete = dialog.getByRole("button", {
        name: "Permanently delete project",
        exact: true,
      });
      await confirmation.fill("wrong project");
      await acknowledgement.check();
      expect(await confirmDelete.isDisabled()).toBe(true);
      await confirmation.fill("Remaining project");
      expect(await confirmDelete.isEnabled()).toBe(true);
      await confirmDelete.click();

      await dialog.waitFor({ state: "detached" });
      expect(new URL(page.url()).pathname).toBe("/");
      await page.getByRole("button", { name: /^New project/ }).click();
      await page.getByRole("dialog", { name: "Create a managed project" }).waitFor();
      expect(deletionRequests).toBe(1);
      expect(await page.evaluate(async () => (
        await fetch("/api/project-session", { cache: "no-store" })
      ).status)).toBe(204);
      expect(existsSync(managedProjectDirectory)).toBe(false);
      const catalogAfterDeletion = JSON.parse(readFileSync(catalogPath, "utf8")) as {
        entries: Array<{ id: string; name: string }>;
      };
      expect(catalogAfterDeletion.entries.some((entry) => entry.id === managedProjectId)).toBe(false);
      expect(catalogAfterDeletion.entries.some((entry) => entry.name === project.meta.name)).toBe(true);
      expect(readFileSync(sourceProjectPath, "utf8")).toBe(sourceBefore);
      expect(readFileSync(remainingSourcePath, "utf8")).toBe(remainingSourceBefore);
    } finally {
      await context.close();
      await server.stop();
    }
  });
});
