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
let managedDataRoot: string;
let inheritedProjectPath: string | undefined;
let inheritedDataRoot: string | undefined;

beforeAll(async () => {
  inheritedProjectPath = process.env.PROJECT_PATH;
  inheritedDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  delete process.env.PROJECT_PATH;
  directory = mkdtempSync(join(tmpdir(), "permanent-project-deletion-"));
  projectRoot = join(directory, "source-project");
  managedDataRoot = join(directory, "managed-data");
  mkdirSync(projectRoot, { recursive: true });
  cpSync(fixtureRoot, projectRoot, { recursive: true });
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
  it("exports an archive, enforces confirmation, deletes once, and routes to App Home", async () => {
    const sourceProjectPath = join(projectRoot, "app-store-screenshots.json");
    const sourceBefore = readFileSync(sourceProjectPath, "utf8");
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
      await page.getByRole("button", { name: "Import project" }).click();
      await page.getByLabel("Choose project folder").setInputFiles(projectRoot);
      await page.getByRole("button", { name: "Import managed copy" }).click();
      await page.waitForURL(`${server.url}/home`);

      const catalogPath = join(managedDataRoot, "catalog.json");
      const [{ id: managedProjectId }] = (JSON.parse(readFileSync(catalogPath, "utf8")) as {
        entries: Array<{ id: string }>;
      }).entries;
      const managedProjectDirectory = join(managedDataRoot, "projects", managedProjectId!);
      const deleteTrigger = page.getByRole("button", {
        name: "Permanently delete project",
        exact: true,
      });

      await deleteTrigger.click();
      await page.getByRole("dialog", { name: "Permanently delete project" }).waitFor();
      await page.keyboard.press("Escape");
      expect(await page.getByRole("dialog", { name: "Permanently delete project" }).count()).toBe(0);
      expect(await deleteTrigger.evaluate((element) => element === document.activeElement)).toBe(true);

      await deleteTrigger.click();
      const dialog = page.getByRole("dialog", { name: "Permanently delete project" });
      const downloadPromise = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Export archive, then continue" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("screenshot-studio-project.zip");

      const confirmation = dialog.getByLabel(`Type ${project.meta.name} to confirm`);
      const acknowledgement = dialog.getByLabel("I understand this project cannot be recovered.");
      const confirmDelete = dialog.getByRole("button", {
        name: "Permanently delete project",
        exact: true,
      });
      await confirmation.fill("wrong project");
      await acknowledgement.check();
      expect(await confirmDelete.isDisabled()).toBe(true);
      await confirmation.fill(project.meta.name);
      expect(await confirmDelete.isEnabled()).toBe(true);
      await confirmDelete.click();

      await page.waitForURL(`${server.url}/`);
      await page.getByRole("heading", {
        name: "Turn product moments into store-ready stories.",
      }).waitFor();
      expect(deletionRequests).toBe(1);
      expect(await page.evaluate(async () => (
        await fetch("/api/project-session", { cache: "no-store" })
      ).status)).toBe(204);
      expect(existsSync(managedProjectDirectory)).toBe(false);
      expect((JSON.parse(readFileSync(catalogPath, "utf8")) as {
        entries: Array<{ id: string }>;
      }).entries.some((entry) => entry.id === managedProjectId)).toBe(false);
      expect(readFileSync(sourceProjectPath, "utf8")).toBe(sourceBefore);
    } finally {
      await context.close();
      await server.stop();
    }
  });
});
