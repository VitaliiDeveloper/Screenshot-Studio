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
  it("shows the final compact App Home without a path field or premature actions", async () => {
    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "load" });
      await page.getByRole("heading", { name: "Turn product moments into store-ready stories." }).waitFor();
      expect(await page.getByRole("textbox").count()).toBe(0);
      expect(await page.getByRole("button", { name: "Create project" }).isDisabled()).toBe(true);
      expect(await page.getByRole("button", { name: "Import project" }).isEnabled()).toBe(true);
      await page.getByRole("heading", { name: "Recent projects" }).waitFor();
    } finally {
      await context.close();
      await server.stop();
    }
  });

  it("opens a configured local project through the same Home and Workspace session", async () => {
    const server = await startWebServer(undefined, {
      projectPath,
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "load" });
      await page.waitForURL(`${server.url}/home`);
      await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
      expect(await page.getByText(realpathSync(projectPath), { exact: true }).count()).toBe(1);
      await page.getByRole("link", { name: "Open workspace" }).click();
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
      await page.getByRole("button", { name: "Import project" }).click();
      await page.getByRole("dialog", { name: "Bring an existing project into Screenshot Studio" }).waitFor();
      await page.getByLabel("Choose project folder").setInputFiles(projectRoot);

      await page.waitForURL(`${server.url}/home`);
      await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
      expect(await page.getByText("managed-project", { exact: true }).count()).toBe(1);
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export project archive" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe("screenshot-studio-project.zip");
      const archivePath = join(directory, "round-trip-project.zip");
      await download.saveAs(archivePath);

      await page.getByRole("link", { name: "Project launcher" }).click();
      await page.waitForURL(`${server.url}/?switch=1`);
      await page.getByRole("button", { name: "Import project" }).click();
      await page.getByLabel("Choose project ZIP").setInputFiles(archivePath);

      await page.waitForURL(`${server.url}/home`);
      await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
      await page.getByRole("link", { name: "Open workspace" }).click();
      await page.waitForURL(`${server.url}/editor`);
      await page.waitForSelector("canvas");
    } finally {
      await context.close();
      await server.stop();
    }
  });
});
