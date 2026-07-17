// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import {
  cpSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = resolve(repoRoot, "fixtures/sample");
let server: RunningServer;
let browser: Browser;
let directory: string;
let projectPath: string;
let projectName: string;
let inheritedProjectPath: string | undefined;

beforeAll(async () => {
  inheritedProjectPath = process.env.PROJECT_PATH;
  delete process.env.PROJECT_PATH;
  directory = mkdtempSync(join(tmpdir(), "project-launcher-"));
  projectPath = join(directory, "app-store-screenshots.json");
  copyFileSync(join(fixtureRoot, "app-store-screenshots.json"), projectPath);
  cpSync(join(fixtureRoot, "assets"), join(directory, "assets"), { recursive: true });
  projectName = (JSON.parse(readFileSync(projectPath, "utf8")) as {
    meta: { name: string };
  }).meta.name;
  server = await startWebServer(undefined, {
    storeSpecsPath: resolve(repoRoot, "store-specs.json"),
  });
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  if (inheritedProjectPath === undefined) delete process.env.PROJECT_PATH;
  else process.env.PROJECT_PATH = inheritedProjectPath;
  rmSync(directory, { recursive: true, force: true });
});

describe("project launcher", () => {
  it("opens a validated local project without an environment path", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(server.url, { waitUntil: "load" });

    await page.getByRole("heading", { name: "Open a screenshot project" }).waitFor();
    await page.getByLabel("Project file path").fill(projectPath);
    await page.getByRole("button", { name: "Open project" }).click();

    await page.waitForURL(`${server.url}/home`);
    await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
    expect(await page.getByText(realpathSync(projectPath), { exact: true }).count()).toBe(1);

    await page.getByRole("link", { name: "Open another project" }).click();
    await page.getByLabel("Project file path").fill(join(directory, "missing.json"));
    await page.getByRole("button", { name: "Open project" }).click();
    await page.getByRole("alert").waitFor();

    await page.goto(`${server.url}/home`, { waitUntil: "load" });
    await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
    await page.getByRole("link", { name: "Open workspace" }).click();
    await page.waitForURL(`${server.url}/editor`);
    await page.waitForSelector("canvas");
    await page.close();
  });
});
