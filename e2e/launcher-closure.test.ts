// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startWebServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let browser: Browser;
let directory: string;
let inheritedProjectPath: string | undefined;
let inheritedDataRoot: string | undefined;

beforeAll(async () => {
  inheritedProjectPath = process.env.PROJECT_PATH;
  inheritedDataRoot = process.env.SCREENSHOT_STUDIO_DATA_ROOT;
  delete process.env.PROJECT_PATH;
  directory = mkdtempSync(join(tmpdir(), "launcher-closure-"));
  process.env.SCREENSHOT_STUDIO_DATA_ROOT = join(directory, "managed-data");
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

describe("Launcher closure journey", () => {
  it("creates an example, returns through Workspace, reopens its recent, and removes history only", async () => {
    const server = await startWebServer(undefined, {
      storeSpecsPath: resolve(repoRoot, "store-specs.json"),
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(server.url, { waitUntil: "load" });
      await page.getByRole("button", { name: "Create isolated example" }).click();
      const creationDialog = page.getByRole("dialog", { name: "Create a managed project" });
      await expect.poll(() => creationDialog.getByLabel("Project name").inputValue())
        .toBe("Isolated feature project");
      const creationResponsePromise = page.waitForResponse("**/api/project-create", { timeout: 60_000 });
      await creationDialog.getByRole("button", { name: "Create project", exact: true }).click();
      const creationResponse = await creationResponsePromise;
      expect(
        creationResponse.status(),
        `Example creation response: ${await creationResponse.text()}`,
      ).toBe(201);

      await Promise.race([
        page.waitForURL(/\/home\?project=project_[a-f0-9]{32}$/u),
        creationDialog.getByRole("alert").waitFor().then(async () => {
          throw new Error(`Example creation failed: ${await creationDialog.getByRole("alert").innerText()}`);
        }),
      ]);
      await page.getByRole("heading", { name: "Isolated feature project", exact: true }).waitFor();
      await page.getByRole("link", { name: "Continue in Workspace", exact: true }).click();
      await page.waitForURL(`${server.url}/editor`);
      await page.waitForSelector("canvas");
      await page.getByRole("button", { name: "Project Home", exact: true }).click();
      await page.waitForURL(/\/home(?:\?.*)?$/u);

      await page.getByRole("button", { name: "Close project", exact: true }).click();
      await page.waitForURL(`${server.url}/?switch=1`);
      const recent = page.getByRole("listitem").filter({ hasText: "Isolated feature project" });
      await recent.getByRole("button", { name: "Open project", exact: true }).waitFor();
      await recent.getByRole("button", { name: "Open project", exact: true }).click();

      await page.waitForURL(/\/home\?project=project_[a-f0-9]{32}$/u);
      await page.getByRole("heading", { name: "Isolated feature project", exact: true }).waitFor();
      await page.getByRole("button", { name: "Close project", exact: true }).click();
      await page.waitForURL(`${server.url}/?switch=1`);

      const reopenedRecent = page.getByRole("listitem").filter({ hasText: "Isolated feature project" });
      await reopenedRecent.getByRole("button", { name: "Remove from recents", exact: true }).click();
      await expect.poll(() => reopenedRecent.count()).toBe(0);
      await page.getByText("No recent projects yet.", { exact: true }).waitFor();
    } finally {
      await context.close();
      await server.stop();
    }
  });
});
