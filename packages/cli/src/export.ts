import { readFile } from "node:fs/promises";
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
} from "@screenshot-studio/core/export";
import { renderScreenToPng } from "./render-driver.js";

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
