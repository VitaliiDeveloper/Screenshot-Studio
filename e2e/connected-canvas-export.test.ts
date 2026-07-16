// SPDX-License-Identifier: Apache-2.0
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import { parseProjectJson } from "../packages/core/src/model/index.js";
import { buildBundleEntries, inspectPng, parseStoreSpecs } from "../packages/core/src/export/index.js";
import { projectMutationLockPath } from "../packages/core/src/storage/index.js";
import { exportBundle, withStableProjectExport } from "../packages/cli/src/export.js";
import { createRenderBrowserSession } from "../packages/cli/src/render-driver.js";
import { startWebServer } from "../packages/cli/src/server.js";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDirectory = resolve(repoRoot, "fixtures/regressions/connected-canvas");
const fixturePath = resolve(fixtureDirectory, "app-store-screenshots.json");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");
const expectedPaths = [
  "apple/iphone/locale-en/01-connected-first-6.9.png",
  "apple/iphone/locale-en/02-connected-second-6.9.png",
  "android/phone/locale-en/01-unrelated-phone-portrait.png",
];

afterAll(async () => {
  await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
  await expect(stat(projectMutationLockPath(fixturePath))).rejects.toMatchObject({ code: "ENOENT" });
});

function pixel(png: PNG, x: number, y: number): [number, number, number] {
  const offset = (y * png.width + x) * 4;
  return [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!];
}

describe("Phase 6 connected bundle export", () => {
  it("exports exact alpha-free crops and isolates unrelated groups", async () => {
    const directory = await mkdtemp(join(tmpdir(), "connected-canvas-export-"));
    const projectDirectory = join(directory, "project");
    const projectPath = join(projectDirectory, "app-store-screenshots.json");
    const outDir = join(directory, "export");
    await cp(fixtureDirectory, projectDirectory, { recursive: true });
    const project = parseProjectJson(await readFile(projectPath, "utf8"));
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const entries = buildBundleEntries(project, specs);
    expect(entries.map((entry) => entry.relativePath)).toEqual(expectedPaths);

    const server = await startWebServer();
    const session = await createRenderBrowserSession();
    try {
      await withStableProjectExport(projectPath, (context) => exportBundle({
        baseUrl: server.url,
        projectPath: context.projectPath,
        projectRevision: context.revision,
        outDir,
        entries,
        renderSession: session,
        publicationGuard: context.publish,
      }));

      const firstBytes = await readFile(join(outDir, expectedPaths[0]!));
      const secondBytes = await readFile(join(outDir, expectedPaths[1]!));
      const unrelatedBytes = await readFile(join(outDir, expectedPaths[2]!));
      for (const [index, bytes] of [firstBytes, secondBytes, unrelatedBytes].entries()) {
        const info = inspectPng(bytes);
        expect(info).toMatchObject({
          width: entries[index]!.target.width,
          height: entries[index]!.target.height,
          hasAlpha: false,
        });
      }

      expect(pixel(PNG.sync.read(firstBytes), 1200, 500)).toEqual([255, 0, 0]);
      expect(pixel(PNG.sync.read(secondBytes), 100, 500)).toEqual([255, 0, 0]);
      expect(pixel(PNG.sync.read(unrelatedBytes), 100, 500)).toEqual([0, 170, 0]);
    } finally {
      await session.close();
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);
});
