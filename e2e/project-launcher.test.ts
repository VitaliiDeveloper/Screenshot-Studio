// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
let projectPath: string;
let projectName: string;
let inheritedProjectPath: string | undefined;
let inheritedDataRoot: string | undefined;

beforeAll(async () => {
  inheritedProjectPath = process.env.PROJECT_PATH;
  inheritedDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  delete process.env.PROJECT_PATH;
  directory = mkdtempSync(join(tmpdir(), "project-launcher-"));
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = join(directory, "managed-data");
  projectRoot = join(directory, "project");
  mkdirSync(projectRoot, { recursive: true });
  copyFileSync(
    join(fixtureRoot, "app-store-screenshots.json"),
    join(projectRoot, "app-store-screenshots.json"),
  );
  cpSync(join(fixtureRoot, "assets"), join(projectRoot, "assets"), { recursive: true });
  projectPath = join(projectRoot, "app-store-screenshots.json");
  projectName = (JSON.parse(readFileSync(projectPath, "utf8")) as Project).meta.name;
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

describe("project launcher", () => {
  it("shows the compact App Home without a path field or premature recents", async () => {
    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const screens: string[] = [];
        Object.defineProperty(window, "__launcherScreens", { value: screens });
        const recordScreen = () => {
          const text = document.body?.innerText ?? "";
          if (text.includes("Screenshot Studio / Projects")) screens.push("projects");
          if (text.includes("Turn product moments into store-ready stories.")) {
            screens.push("first-run");
          }
        };
        new MutationObserver(recordScreen).observe(document, { childList: true, subtree: true });
      });
      await page.goto(server.url, { waitUntil: "load" });
      await page.getByRole("heading", {
        name: "Turn product moments into store-ready stories.",
      }).waitFor();
      const renderedScreens = await page.evaluate(() => (
        window as unknown as { __launcherScreens: string[] }
      ).__launcherScreens);
      expect(renderedScreens).toContain("first-run");
      expect(renderedScreens).not.toContain("projects");
      expect(await page.getByRole("textbox").count()).toBe(0);
      expect(await page.getByRole("button", { name: "New project" }).isEnabled()).toBe(true);
      expect(await page.getByRole("button", { name: "Import" }).isEnabled()).toBe(true);
      await page.getByRole("button", { name: "Import" }).click();
      const dialog = page.getByRole("dialog", { name: "Bring an existing project into Screenshot Studio" });
      const backdrop = page.locator(".launcher-dialog-backdrop");
      await dialog.waitFor();
      expect(await dialog.evaluate((element) => getComputedStyle(element).animationName))
        .toContain("launcher-dialog-in");
      await page.getByRole("button", { name: "Close project import" }).click();
      expect(await backdrop.getAttribute("data-motion")).toBe("closing");
      expect(await dialog.evaluate((element) => getComputedStyle(element).animationName))
        .toContain("launcher-dialog-out");
      await dialog.waitFor({ state: "detached" });
      expect(await page.getByRole("button", { name: "Import" }).evaluate(
        (element) => element === document.activeElement,
      )).toBe(true);

      await page.getByRole("button", { name: "Import" }).click();
      await dialog.waitFor();
      await page.keyboard.press("Escape");
      expect(await backdrop.getAttribute("data-motion")).toBe("closing");
      await dialog.waitFor({ state: "detached" });
      await page.getByRole("heading", {
        name: "Turn product moments into store-ready stories.",
      }).waitFor();
    } finally {
      await context.close();
      await server.stop();
    }
  });

  it("lists a configured local project source-safely and opens it in Workspace", async () => {
    const server = await startWebServer(undefined, {
      projectPath,
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "load" });
      await page.getByRole("heading", { name: "Recent projects" }).waitFor();
      expect(await page.getByText(realpathSync(projectPath), { exact: false }).count()).toBe(0);
      await page.getByRole("button", {
        name: `Open ${projectName} in Workspace`,
        exact: true,
      }).click();
      await page.waitForURL(`${server.url}/editor`);
      await page.waitForSelector("canvas");
    } finally {
      await context.close();
      await server.stop();
    }
  });

  it("imports a Folder into a managed copy and round-trips its project archive", async () => {
    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "load" });
      await page.getByRole("button", { name: "Import" }).click();
      const dialog = page.getByRole("dialog", {
        name: "Bring an existing project into Screenshot Studio",
      });
      await dialog.waitFor();
      await page.getByLabel("Choose project folder").setInputFiles(projectRoot);
      await page.getByRole("heading", { name: "Import a managed copy?" }).waitFor();
      expect(new URL(page.url()).pathname).toBe("/");
      const chooseAnotherSource = page.getByRole("button", { name: "Choose another source" });
      await chooseAnotherSource.focus();
      await page.keyboard.press("Tab");
      expect(await page.locator(".launcher-dialog-panel summary").evaluate(
        (element) => element === document.activeElement,
      )).toBe(true);
      await page.keyboard.press("Tab");
      expect(await page.getByRole("button", { name: "Close project import" })
        .evaluate((element) => element === document.activeElement)).toBe(true);
      await chooseAnotherSource.click();
      await page.getByRole("button", { name: /^Folder Recommended/ }).waitFor();
      await page.getByLabel("Choose project folder").setInputFiles(projectRoot);
      await page.getByRole("button", { name: "Import managed copy" }).click();

      await page.waitForURL(`${server.url}/editor`);
      await page.goto(`${server.url}/home`, { waitUntil: "load" });
      await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
      expect(await page.getByText("Managed project", { exact: true }).count()).toBe(1);
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export archive", exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("screenshot-studio-project.zip");
      const archivePath = join(directory, "round-trip-project.zip");
      await download.saveAs(archivePath);

      await page.getByRole("link", { name: "Projects", exact: true }).click();
      await page.waitForURL(`${server.url}/`);
      await page.getByRole("button", { name: "Import" }).click();
      await page.getByLabel("Choose project ZIP").setInputFiles(archivePath);
      await page.getByRole("heading", { name: "Import a managed copy?" }).waitFor();
      await page.getByRole("button", { name: "Import managed copy" }).click();

      await page.waitForURL(`${server.url}/editor`);
      await page.goto(`${server.url}/home`, { waitUntil: "load" });
      await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
      await page.getByRole("link", { name: "Open in Editor", exact: true }).click();
      await page.waitForURL(`${server.url}/editor`);
      await page.waitForSelector("canvas");
    } finally {
      await context.close();
      await server.stop();
    }
  });
});
