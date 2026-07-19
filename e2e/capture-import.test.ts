// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import {
  copyFileSync,
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
let browser: Browser;
let directory: string;
let captureRoot: string;
let managedDataRoot: string;
let inheritedProjectPath: string | undefined;
let inheritedDataRoot: string | undefined;

beforeAll(async () => {
  inheritedProjectPath = process.env.PROJECT_PATH;
  inheritedDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  delete process.env.PROJECT_PATH;
  directory = mkdtempSync(join(tmpdir(), "capture-import-e2e-"));
  captureRoot = join(directory, "selected-captures");
  managedDataRoot = join(directory, "managed-data");
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = managedDataRoot;
  const localeRoot = join(captureRoot, "screenshots", "apple", "iphone", "en");
  mkdirSync(localeRoot, { recursive: true });
  copyFileSync(
    join(repoRoot, "fixtures", "sample", "assets", "demo-logistics-app.png"),
    join(localeRoot, "01.png"),
  );
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

describe("Launcher 6 capture import", () => {
  it("previews an explicit new-project receiver, confirms once, and opens that Project Home", async () => {
    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "load" });
      await page.getByRole("button", { name: "Capture import" }).click();
      const dialog = page.getByRole("dialog", { name: "Capture import" });
      await dialog.locator('input[type="file"][webkitdirectory]').setInputFiles(captureRoot);

      expect(await dialog.getByRole("button", { name: "Preview capture import" }).isDisabled())
        .toBe(true);
      await dialog.getByRole("radio", { name: /New managed project/ }).check();
      await dialog.getByLabel("Project name").fill("Captured launch");
      expect(existsSync(managedDataRoot)).toBe(false);

      await dialog.getByRole("button", { name: "Preview capture import" }).click();
      await page.getByRole("dialog", { name: "Review capture import" }).waitFor();
      expect(await page.getByText("Captured launch", { exact: true }).count()).toBe(1);
      expect(await page.getByText("New managed project · Layout: Default", { exact: true }).count())
        .toBe(1);
      expect(await page.getByText("1 screen", { exact: true }).count()).toBe(1);
      expect(await page.getByText("apple (1)", { exact: true }).count()).toBe(1);
      expect(await page.getByText("apple/iphone (1)", { exact: true }).count()).toBe(1);
      expect(await page.getByText("en (1)", { exact: true }).count()).toBe(1);
      expect(await page.locator('section[aria-labelledby="planned-screens"]')
        .getByText("screenshots/apple/iphone/en/01.png", { exact: true }).count()).toBe(1);
      expect(existsSync(managedDataRoot)).toBe(false);
      expect(await page.evaluate(async () => (
        await fetch("/api/project-session", { cache: "no-store" })
      ).status)).toBe(204);

      const applyResponsePending = page.waitForResponse((response) => (
        response.url().endsWith("/api/capture-import/apply")
        && response.request().method() === "POST"
      ), { timeout: 60_000 });
      await page.getByRole("button", { name: "Confirm capture import" }).click();
      const applyResponse = await applyResponsePending;
      expect(applyResponse.status(), await applyResponse.text()).toBe(201);
      const appliedProjectId = await applyResponse.headerValue("x-project-id");
      await expect.poll(() => page.url(), { timeout: 30_000 })
        .toMatch(/\/home\?project=project_[0-9a-f]{32}$/u);
      await page.getByRole("heading", { name: "Captured launch", exact: true }).waitFor();

      const catalog = JSON.parse(readFileSync(join(managedDataRoot, "catalog.json"), "utf8")) as {
        entries: Array<{ id: string; name: string }>;
      };
      expect(catalog.entries).toHaveLength(1);
      expect(catalog.entries[0]).toMatchObject({ name: "Captured launch" });
      const receiverId = catalog.entries[0]!.id;
      expect(appliedProjectId).toBe(receiverId);
      expect(new URL(page.url()).searchParams.get("project")).toBe(receiverId);
      const project = JSON.parse(readFileSync(join(
        managedDataRoot,
        "projects",
        receiverId,
        "app-store-screenshots.json",
      ), "utf8")) as Project;
      expect(project.layouts[0]!.screens).toHaveLength(1);
      expect(project.layouts[0]!.screens[0]).toMatchObject({
        platform: "apple",
        device: "iphone",
        locale: "en",
      });
    } finally {
      await context.close();
      await server.stop();
    }
  });
});
