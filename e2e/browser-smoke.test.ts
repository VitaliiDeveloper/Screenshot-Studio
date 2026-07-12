// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, firefox, webkit, type BrowserType } from "playwright";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer, type RunningServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sampleRoot = join(repoRoot, "fixtures", "phase-0-sample");
const sampleProject = join(sampleRoot, "app-store-screenshots.json");
const engines: Array<{ name: string; type: BrowserType }> = [
  { name: "Chromium", type: chromium },
  { name: "Firefox", type: firefox },
  { name: "WebKit", type: webkit },
];

let directory: string;
let projectPath: string;
let originalProject: string;
let server: RunningServer;

interface ProjectFile {
  screens: Array<{
    id: string;
    name: string;
    device: string;
    elements: Array<{ id: string; type: string; name?: string }>;
  }>;
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "browser-smoke-e2e-"));
  projectPath = join(directory, "app-store-screenshots.json");
  originalProject = await readFile(sampleProject, "utf8");
  await writeFile(projectPath, originalProject);
  await cp(join(sampleRoot, "assets"), join(directory, "assets"), { recursive: true });
  server = await startWebServer(undefined, { projectPath });
}, 180_000);

afterAll(async () => {
  await server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("representative cross-browser editor smoke", () => {
  for (const engine of engines) {
    it(`${engine.name} loads, navigates, authors, persists, and reloads`, async () => {
      await writeFile(projectPath, originalProject);
      const browser = await engine.type.launch();
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        await page.goto(`${server.url}/editor`, { waitUntil: "load" });
        await page.waitForSelector("canvas");

        const before = JSON.parse(await readFile(projectPath, "utf8")) as ProjectFile;
        const secondScreen = before.screens[1]!;
        await page.getByRole("button", {
          name: `${secondScreen.name} · ${secondScreen.device}`,
          exact: true,
        }).click();
        await page.getByRole("list", { name: `Layers for ${secondScreen.name}` }).waitFor();

        const priorCount = secondScreen.elements.length;
        const priorShapeCount = secondScreen.elements.filter((element) => element.type === "shape").length;
        await page.getByRole("button", { name: "Add element", exact: true }).click();
        await page.getByRole("button", { name: "+ Shape", exact: true }).click();
        await expect.poll(async () => {
          const current = JSON.parse(await readFile(projectPath, "utf8")) as ProjectFile;
          return current.screens[1]!.elements.length;
        }, { timeout: 10_000 }).toBe(priorCount + 1);

        const persisted = JSON.parse(await readFile(projectPath, "utf8")) as ProjectFile;
        const inserted = persisted.screens[1]!.elements.at(-1)!;
        expect(inserted.type).toBe("shape");
        await page.reload({ waitUntil: "load" });
        await page.waitForSelector("canvas");
        await page.getByRole("button", {
          name: `${secondScreen.name} · ${secondScreen.device}`,
          exact: true,
        }).click();
        const structurePanel = page.getByRole("button", {
          name: "Structure panel",
          exact: true,
        });
        if ((await structurePanel.getAttribute("aria-pressed")) !== "true") {
          await structurePanel.click();
        }
        const layers = page.getByRole("list", { name: `Layers for ${secondScreen.name}` });
        await layers.waitFor();
        expect(await layers.getByRole("button", { name: "Shape", exact: true }).count()).toBe(priorShapeCount + 1);
        await page.close();
      } finally {
        await browser.close();
      }
    }, 180_000);
  }
});
