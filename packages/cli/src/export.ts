import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import {
  parseProjectJson,
  getScreen,
  type Project,
} from "@screenshot-studio/core/model";
import {
  parseStoreSpecs,
  findStoreSize,
  exportPixelRatio,
  stripAlpha,
  assertDimensions,
  type StoreSize,
  type BundleEntry,
} from "@screenshot-studio/core/export";
import { renderScreenToPng, type RenderBrowserSession } from "./render-driver.js";

/**
 * Export orchestration (Node side). Renders a screen through the served web renderer, then does
 * the store post-processing that must happen off-canvas: strip alpha (stores reject
 * transparency) and assert exact target dimensions (docs/architecture.md §4). One export path,
 * shared by the CLI command and the parity harness — the same result the UI button must match.
 */
export interface ExportScreenOptions {
  baseUrl: string;
  projectPath: string;
  screenId: string;
  target: StoreSize;
  headless?: boolean;
}

/** Render + flatten + verify one screen, returning a store-ready PNG buffer. */
export async function exportScreenToPng(opts: ExportScreenOptions): Promise<Buffer> {
  const { baseUrl, projectPath, screenId, target, headless } = opts;
  const project = await loadProject(projectPath);
  const screen = getScreen(project, screenId);

  const pixelRatio = exportPixelRatio(screen.artboard, { width: target.width, height: target.height });
  const raw = await renderScreenToPng({ baseUrl, projectPath, screenId, pixelRatio, headless });

  const flattened = stripAlpha(raw);
  assertDimensions(flattened, { width: target.width, height: target.height });
  return flattened;
}

async function loadProject(projectPath: string): Promise<Project> {
  return parseProjectJson(await readFile(projectPath, "utf8"));
}

/** Resolve a target store size for a screen from store-specs.json. */
export async function resolveTarget(
  storeSpecsPath: string,
  platform: string,
  device: string,
  sizeId: string,
): Promise<StoreSize> {
  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  return findStoreSize(specs, platform, device, sizeId);
}

export interface RenderedBundleEntry {
  entry: BundleEntry;
  png: Buffer;
}

export async function writeBundleOutputs({
  outDir,
  entries,
}: {
  outDir: string;
  entries: RenderedBundleEntry[];
}): Promise<string> {
  const zip = new JSZip();

  for (const { entry, png } of entries) {
    const outFile = join(outDir, entry.relativePath);
    await mkdir(dirname(outFile), { recursive: true });
    await writeFile(outFile, png);
    zip.file(entry.relativePath, png);
  }

  const zipPath = join(outDir, "app-store-screenshots-bundle.zip");
  await mkdir(outDir, { recursive: true });
  await writeFile(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
  return zipPath;
}

export async function exportBundle({
  baseUrl,
  projectPath,
  outDir,
  entries,
  renderSession,
}: {
  baseUrl: string;
  projectPath: string;
  outDir: string;
  entries: BundleEntry[];
  renderSession: Pick<RenderBrowserSession, "renderScreenToPng">;
}): Promise<string> {
  const rendered: RenderedBundleEntry[] = [];

  for (const entry of entries) {
    try {
      const pixelRatio = exportPixelRatio(entry.screen.artboard, {
        width: entry.target.width,
        height: entry.target.height,
      });
      const raw = await renderSession.renderScreenToPng({
        baseUrl,
        projectPath,
        screenId: entry.screen.id,
        pixelRatio,
      });
      const flattened = stripAlpha(raw);
      assertDimensions(flattened, { width: entry.target.width, height: entry.target.height });
      rendered.push({ entry, png: flattened });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to export screen "${entry.screen.id}" target "${entry.target.id}": ${message}`, {
        cause: err,
      });
    }
  }

  return writeBundleOutputs({ outDir, entries: rendered });
}
