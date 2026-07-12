// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import {
  parseProjectJson,
  getScreen,
  type Project,
} from "@screenshot-studio/core/model";
import {
  parseStoreSpecs,
  findStoreSize,
  type StoreSize,
  type BundleEntry,
} from "@screenshot-studio/core/export";
import { renderScreenToPng, type RenderBrowserSession } from "./render-driver.js";
import { renderStoreReadyPng } from "./store-ready-png.js";
import { writeBundleOutputs, type RenderedBundleEntry } from "./bundle-publisher.js";

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

  return renderStoreReadyPng({
    screen,
    target,
    render: (pixelRatio) => renderScreenToPng({ baseUrl, projectPath, screenId, pixelRatio, headless }),
  });
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
      const png = await renderStoreReadyPng({
        screen: entry.screen,
        target: entry.target,
        render: (pixelRatio) => renderSession.renderScreenToPng({
          baseUrl,
          projectPath,
          screenId: entry.screen.id,
          pixelRatio,
        }),
      });
      rendered.push({ entry, png });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to export screen "${entry.screen.id}" target "${entry.target.id}": ${message}`, {
        cause: err,
      });
    }
  }

  return writeBundleOutputs({ outDir, entries: rendered });
}
