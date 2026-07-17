// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
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
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureRoot = resolve(repoRoot, "fixtures/sample");
const alternateFont = resolve(
  repoRoot,
  "examples/rtl-delivery/assets/fonts/noto-sans-arabic-700.ttf",
);
let server: RunningServer;
let browser: Browser;
let directory: string;
let firstRoot: string;
let secondRoot: string;
let firstProjectPath: string;
let secondProjectPath: string;
let projectName: string;
let inheritedProjectPath: string | undefined;

function populateProject(root: string): void {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  copyFileSync(
    join(fixtureRoot, "app-store-screenshots.json"),
    join(root, "app-store-screenshots.json"),
  );
  cpSync(join(fixtureRoot, "assets"), join(root, "assets"), { recursive: true });
}

function resetProjects(): void {
  populateProject(firstRoot);
  populateProject(secondRoot);
  copyFileSync(alternateFont, join(secondRoot, "assets/fonts/Pacifico-Regular.ttf"));
}

function readProject(path: string): Project {
  return JSON.parse(readFileSync(path, "utf8")) as Project;
}

function headlineWidth(path: string): number {
  for (const layout of readProject(path).layouts) {
    for (const screen of layout.screens) {
      const headline = screen.elements.find((element) => element.id === "headline");
      if (headline) return headline.width;
    }
  }
  throw new Error("headline fixture missing");
}

async function openProject(page: Page, projectPath: string): Promise<void> {
  await page.goto(server.url, { waitUntil: "load" });
  await page.getByRole("heading", { name: "Open a screenshot project" }).waitFor();
  await page.getByLabel("Project file path").fill(projectPath);
  await page.getByRole("button", { name: "Open project" }).click();
  await page.waitForURL(`${server.url}/home`);
  try {
    await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
  } catch (error) {
    throw new Error(`Project Home did not render: ${await page.locator("body").innerText()}`, {
      cause: error,
    });
  }
}

async function openWorkspace(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Open workspace" }).click();
  await page.waitForURL(`${server.url}/editor`);
  try {
    await page.waitForSelector("canvas");
  } catch (error) {
    throw new Error(`Workspace did not render: ${await page.locator("body").innerText()}`, {
      cause: error,
    });
  }
}

async function measureProjectFont(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const sample = "Screenshot Studio identity iiiWWW 0123";
    await document.fonts.load('400 48px "Pacifico"', sample);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.font = '400 48px "Pacifico"';
    return context.measureText(sample).width;
  });
}

beforeAll(async () => {
  inheritedProjectPath = process.env.PROJECT_PATH;
  delete process.env.PROJECT_PATH;
  directory = mkdtempSync(join(tmpdir(), "project-launcher-"));
  firstRoot = join(directory, "project-a");
  secondRoot = join(directory, "project-b");
  firstProjectPath = join(firstRoot, "app-store-screenshots.json");
  secondProjectPath = join(secondRoot, "app-store-screenshots.json");
  resetProjects();
  projectName = readProject(firstProjectPath).meta.name;
  server = await startWebServer(undefined, {
    storeSpecsPath: resolve(repoRoot, "store-specs.json"),
  });
  browser = await chromium.launch();
}, 180_000);

beforeEach(() => {
  resetProjects();
});

afterAll(async () => {
  await browser?.close();
  await server?.stop();
  if (inheritedProjectPath === undefined) delete process.env.PROJECT_PATH;
  else process.env.PROJECT_PATH = inheritedProjectPath;
  rmSync(directory, { recursive: true, force: true });
});

describe("project launcher", () => {
  it("opens a validated local project without an environment path", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await openProject(page, firstProjectPath);

    expect(await page.getByText(realpathSync(firstProjectPath), { exact: true }).count()).toBe(1);

    await page.getByRole("link", { name: "Open another project" }).click();
    await page.getByLabel("Project file path").fill(join(directory, "missing.json"));
    await page.getByRole("button", { name: "Open project" }).click();
    await page.getByRole("alert").waitFor();

    await page.goto(`${server.url}/home`, { waitUntil: "load" });
    await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
    await openWorkspace(page);
    await context.close();
  });

  it("drains A before switching identical-revision B and replaces same-document resources", async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    await openProject(page, firstProjectPath);
    const staleA = await page.evaluate(async () => {
      const response = await fetch("/api/project");
      return {
        project: await response.json() as Project,
        projectId: response.headers.get("x-project-id")!,
        revision: response.headers.get("etag")!,
      };
    });
    const secondBefore = readFileSync(secondProjectPath);
    await openWorkspace(page);
    const firstFontWidth = await measureProjectFont(page);
    await page.evaluate(async ({ projectId, revision }) => {
      const query = new URLSearchParams({
        projectId,
        revision,
        path: "assets/fonts/Pacifico-Regular.ttf",
      });
      const response = await fetch(`/api/asset?${query}`);
      const face = new FontFace("Pacifico", await response.arrayBuffer(), { weight: "900" });
      await face.load();
      document.fonts.add(face);
      (window as typeof window & { __unrelatedSwitchFace?: FontFace })
        .__unrelatedSwitchFace = face;
    }, staleA);

    await page.getByRole("button", { name: "Hero headline", exact: true }).click();
    const width = page.getByRole("spinbutton", { name: "Width", exact: true });
    const changedWidth = Number(await width.inputValue()) + 17;
    await width.fill(String(changedWidth));
    await Promise.all([
      page.waitForURL(`${server.url}/home`),
      page.goBack(),
    ]);
    await page.getByRole("heading", { name: projectName, exact: true }).waitFor();

    await page.getByRole("link", { name: "Open another project" }).click();
    await page.getByLabel("Project file path").fill(secondProjectPath);
    await page.getByRole("button", { name: "Open project" }).click();
    await page.waitForURL(`${server.url}/home`);

    const activeB = await page.evaluate(async () => {
      const response = await fetch("/api/project");
      return {
        projectId: response.headers.get("x-project-id")!,
        revision: response.headers.get("etag")!,
      };
    });
    expect(activeB.projectId).not.toBe(staleA.projectId);
    expect(activeB.revision).toBe(staleA.revision);
    expect(readFileSync(secondProjectPath)).toEqual(secondBefore);

    const staleSave = await page.evaluate(async ({ project, projectId, revision }) => {
      project.meta.name = "Stale project A tab";
      const response = await fetch("/api/project", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "if-match": revision,
          "x-project-id": projectId,
        },
        body: JSON.stringify(project),
      });
      return { status: response.status, body: await response.json() as { error?: string } };
    }, staleA);
    expect(staleSave).toMatchObject({ status: 409, body: { error: expect.any(String) } });
    expect(readFileSync(secondProjectPath)).toEqual(secondBefore);

    await openWorkspace(page);
    const secondFont = await page.evaluate(async () => {
      const sample = "Screenshot Studio identity iiiWWW 0123";
      await document.fonts.load('400 48px "Pacifico"', sample);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      context.font = '400 48px "Pacifico"';
      const sentinel = (window as typeof window & { __unrelatedSwitchFace?: FontFace })
        .__unrelatedSwitchFace;
      return {
        width: context.measureText(sample).width,
        sentinelPresent: Boolean(sentinel && document.fonts.has(sentinel)),
        managedFaces: [...document.fonts].filter(
          (face) => face.family === "Pacifico" && String(face.weight) === "400",
        ).length,
      };
    });

    expect(Math.abs(secondFont.width - firstFontWidth)).toBeGreaterThan(1);
    expect(secondFont.sentinelPresent).toBe(true);
    expect(secondFont.managedFaces).toBe(1);
    expect(headlineWidth(firstProjectPath)).toBe(changedWidth);
    expect(readFileSync(secondProjectPath)).toEqual(secondBefore);
    await context.close();
  });

  it("blocks project activation when draining A fails", async () => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1200 } });
    const page = await context.newPage();
    await openProject(page, firstProjectPath);
    await openWorkspace(page);
    const firstBefore = readFileSync(firstProjectPath);
    const secondBefore = readFileSync(secondProjectPath);
    let activationPosts = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/api/project-session") {
        activationPosts += 1;
      }
    });
    await page.route("**/api/project", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "disk unavailable" }),
        });
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: "Hero headline", exact: true }).click();
    const width = page.getByRole("spinbutton", { name: "Width", exact: true });
    await width.fill(String(Number(await width.inputValue()) + 1));
    await Promise.all([
      page.waitForURL(`${server.url}/home`),
      page.goBack(),
    ]);
    try {
      await page.getByRole("heading", { name: projectName, exact: true }).waitFor();
    } catch (error) {
      throw new Error(`Project Home did not return after failed edit: ${await page.locator("body").innerText()}`, {
        cause: error,
      });
    }
    await page.getByRole("link", { name: "Open another project" }).click();
    await page.getByLabel("Project file path").fill(secondProjectPath);
    await page.getByRole("button", { name: "Open project" }).click();

    await page.getByRole("alert").filter({ hasText: "disk unavailable" }).waitFor();
    expect(new URL(page.url()).pathname).toBe("/");
    expect(activationPosts).toBe(0);
    const activeName = await page.evaluate(async () => {
      const response = await fetch("/api/project-session", { cache: "no-store" });
      return ((await response.json()) as { name: string }).name;
    });
    expect(activeName).toBe(projectName);
    expect(readFileSync(firstProjectPath)).toEqual(firstBefore);
    expect(readFileSync(secondProjectPath)).toEqual(secondBefore);
    await context.close();
  });
});
