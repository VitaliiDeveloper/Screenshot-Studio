// SPDX-License-Identifier: Apache-2.0
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseProjectJson } from "@screenshot-studio/core/model";
import { buildBundleEntries, parseStoreSpecs, type BundleEntry } from "@screenshot-studio/core/export";
import { startWebServer } from "@screenshot-studio/cli/server";
import { createRenderBrowserSession, type RenderBrowserSession } from "@screenshot-studio/cli/render-driver";
import { exportBundle, withStableProjectExport } from "@screenshot-studio/cli/export";

/**
 * 1:1 screenshots through the real render host: the finished PNG must hold the cropped source's
 * exact RGB values at the box (an exact-dimension check on top of the export's own verification),
 * and export must fail with a clear message when the pixels cannot survive.
 */
const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixtureDirectory = resolve(repoRoot, "fixtures/regressions/native-screenshot");
const storeSpecsPath = resolve(repoRoot, "store-specs.json");
const SHOT = { x: 270, y: 400, top: 40, width: 540, height: 890 };

let server: Awaited<ReturnType<typeof startWebServer>>;
let session: RenderBrowserSession;
const directories: string[] = [];

beforeAll(async () => {
  server = await startWebServer(undefined, { storeSpecsPath });
  session = await createRenderBrowserSession();
}, 180_000);

afterAll(async () => {
  await session?.close();
  await server?.stop();
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

/** RGB values of a rectangle, read the same way from the source file and the finished PNG. */
function rgb(png: PNG, left: number, top: number, width: number, height: number): Buffer {
  const out = Buffer.alloc(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const from = ((top + row) * png.width + left + column) * 4;
      out.set(png.data.subarray(from, from + 3), (row * width + column) * 3);
    }
  }
  return out;
}

async function exportScreen(screenId: string): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "native-screenshot-"));
  directories.push(directory);
  const projectDirectory = join(directory, "project");
  const projectPath = join(projectDirectory, "app-store-screenshots.json");
  await cp(fixtureDirectory, projectDirectory, { recursive: true });
  const project = parseProjectJson(await readFile(projectPath, "utf8"));
  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  const entries: BundleEntry[] = buildBundleEntries(project, "default", specs, {})
    .filter((entry) => entry.screen.id === screenId);
  const outDir = join(directory, "export");
  await withStableProjectExport(projectPath, (context) => exportBundle({
    baseUrl: server.url,
    projectPath: context.projectPath,
    projectRevision: context.revision,
    layoutId: "default",
    outDir,
    entries,
    renderSession: session,
    publicationGuard: context.publish,
  }));
  return readFile(join(outDir, entries[0]!.relativePath));
}

describe("native (1:1) screenshot export", () => {
  it("writes the cropped source unchanged at its box in an exact-size PNG", async () => {
    const png = PNG.sync.read(await exportScreen("exact"));
    expect([png.width, png.height]).toEqual([1080, 1920]);
    const source = PNG.sync.read(await readFile(resolve(fixtureDirectory, "assets/shot.png")));
    expect(rgb(png, SHOT.x, SHOT.y, SHOT.width, SHOT.height)
      .equals(rgb(source, 0, SHOT.top, SHOT.width, SHOT.height))).toBe(true);
  }, 120_000);

  it("fails when another layer covers the shot", async () => {
    await expect(exportScreen("covered"))
      .rejects.toThrow(/1:1 screenshot "phone-shot" differs from its source in \d+ pixel\(s\)/);
  }, 120_000);

  it("fails with a color-profile hint when the browser converts a Display P3 source", async () => {
    await expect(exportScreen("display-p3")).rejects.toThrow(/embedded color profile/);
  }, 120_000);
});
