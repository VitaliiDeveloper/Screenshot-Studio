// SPDX-License-Identifier: Apache-2.0
import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import { parseProjectJson } from "@screenshot-studio/core/model";
import { buildBundleEntries, inspectPng, migrateLeadTarget, parseStoreSpecs } from "@screenshot-studio/core/export";
import { projectMutationLockPath } from "@screenshot-studio/core/storage";
import { exportBundle, withStableProjectExport } from "@screenshot-studio/cli/export";
import { createRenderBrowserSession } from "@screenshot-studio/cli/render-driver";
import { startWebServer } from "@screenshot-studio/cli/server";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDirectory = resolve(repoRoot, "fixtures/regressions/connected-canvas");
const fixturePath = resolve(fixtureDirectory, "app-store-screenshots.json");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");
const expectedPaths = [
  "apple/iphone/locale-en/size-6.3/01-connected-first-6.3.png",
  "apple/iphone/locale-en/size-6.3/02-connected-second-6.3.png",
  "android/phone/locale-en/size-phone-portrait/01-unrelated-phone-portrait.png",
  "apple/iphone/locale-en/size-6.9/01-connected-first-6.9.png",
  "apple/iphone/locale-en/size-6.9/02-connected-second-6.9.png",
];

afterAll(async () => {
  await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
  await expect(stat(projectMutationLockPath(fixturePath))).rejects.toMatchObject({ code: "ENOENT" });
});

function pixel(png: PNG, x: number, y: number): [number, number, number] {
  const offset = (y * png.width + x) * 4;
  return [png.data[offset]!, png.data[offset + 1]!, png.data[offset + 2]!];
}

describe("connected bundle export", () => {
  it("exports exact alpha-free crops of a lead-migrated layout and isolates unrelated groups", async () => {
    const directory = await mkdtemp(join(tmpdir(), "connected-canvas-export-"));
    const projectDirectory = join(directory, "project");
    const projectPath = join(projectDirectory, "app-store-screenshots.json");
    const outDir = join(directory, "export");
    await cp(fixtureDirectory, projectDirectory, { recursive: true });
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    // The fixture is authored at the former 6.9" lead; each connected row exports as its own crop.
    const { project } = migrateLeadTarget(
      parseProjectJson(await readFile(projectPath, "utf8")),
      specs,
      "apple",
      "iphone",
      "6.9",
    );
    await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`);
    const entries = buildBundleEntries(project, project.preferredExportLayoutId, specs);
    expect(entries.map((entry) => entry.relativePath)).toEqual(expectedPaths);

    const server = await startWebServer(undefined, { storeSpecsPath });
    const session = await createRenderBrowserSession();
    try {
      await withStableProjectExport(projectPath, (context) => exportBundle({
        baseUrl: server.url,
        projectPath: context.projectPath,
        projectRevision: context.revision,
        layoutId: project.preferredExportLayoutId,
        outDir,
        entries,
        renderSession: session,
        publicationGuard: context.publish,
      }));

      const [firstBytes, secondBytes, unrelatedBytes, previousFirstBytes, previousSecondBytes] = await Promise.all(
        expectedPaths.map((path) => readFile(join(outDir, path))),
      );
      for (const [index, bytes] of [firstBytes!, secondBytes!, unrelatedBytes!, previousFirstBytes!, previousSecondBytes!].entries()) {
        const info = inspectPng(bytes);
        expect(info).toMatchObject({
          width: entries[index]!.target.width,
          height: entries[index]!.target.height,
          hasAlpha: false,
        });
      }

      for (const [first, second] of [[firstBytes!, secondBytes!], [previousFirstBytes!, previousSecondBytes!]]) {
        expect(pixel(PNG.sync.read(first!), 1200, 500)).toEqual([255, 0, 0]);
        expect(pixel(PNG.sync.read(second!), 100, 500)).toEqual([255, 0, 0]);
      }
      expect(pixel(PNG.sync.read(unrelatedBytes!), 100, 500)).toEqual([0, 170, 0]);
    } finally {
      await session.close();
      await server.stop();
      await rm(directory, { recursive: true, force: true });
    }
  }, 180_000);
});
