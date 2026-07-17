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
let projectPath: string;
let projectName: string;
let inheritedProjectPath: string | undefined;

beforeAll(async () => {
  inheritedProjectPath = process.env.PROJECT_PATH;
  delete process.env.PROJECT_PATH;
  directory = mkdtempSync(join(tmpdir(), "project-launcher-"));
  const projectRoot = join(directory, "project");
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
  rmSync(directory, { recursive: true, force: true });
});

describe("project launcher foundation", () => {
  it("shows an honest no-active-project App Home without a path field", async () => {
    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "load" });
      await page.getByRole("heading", { name: "No active project" }).waitFor();
      expect(await page.getByRole("textbox").count()).toBe(0);
      expect(await page.getByText("PROJECT_PATH", { exact: false }).count()).toBeGreaterThan(0);
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
});
