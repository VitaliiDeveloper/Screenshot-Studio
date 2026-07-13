// SPDX-License-Identifier: Apache-2.0
import type { Project } from "../model/schema.js";
import { elementLeaves } from "../model/element-tree.js";
import type { ImageCache } from "../engine/node-config.js";

/**
 * Browser-side image preloading — the asset analog of core/fonts (docs/architecture.md §5). The
 * render must not be captured until every image has decoded, or headless export can capture a
 * blank frame. Callers must await loadProjectImages before rendering and before setting
 * window.__stageReady.
 *
 * `core` stays network-agnostic: the host injects `resolve` (assetUrl -> a loadable, same-origin
 * URL). A failed asset is simply absent from the cache — the map renders a placeholder, the render
 * still completes.
 */
export type { ImageCache } from "../engine/node-config.js";

/** Every distinct raster assetUrl in the project. Pure. */
export function collectImageUrls(project: Project): string[] {
  const urls = new Set<string>();
  for (const screen of project.screens) {
    if (screen.background.type === "image") urls.add(screen.background.assetUrl);
    for (const el of screen.elements) {
      for (const leaf of elementLeaves(el)) {
        if (leaf.type === "screenshot" || leaf.type === "image" || leaf.type === "device-frame") {
          urls.add(leaf.assetUrl);
        }
      }
    }
  }
  return [...urls];
}

/** Decode one image; resolves to the element or null if it fails to load. */
function loadOne(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolveP) => {
    const img = new Image();
    img.onload = () => resolveP(img);
    img.onerror = () => resolveP(null);
    // Same-origin route; no crossOrigin needed.
    img.src = url;
  });
}

/** Load and decode every screenshot image, keyed by the document assetUrl. Failed assets omitted. */
export async function loadProjectImages(
  project: Project,
  resolve: (assetUrl: string) => string,
): Promise<ImageCache> {
  const cache: ImageCache = new Map();
  await Promise.all(
    collectImageUrls(project).map(async (assetUrl) => {
      const img = await loadOne(resolve(assetUrl));
      if (img) {
        try {
          await img.decode();
        } catch {
          /* onload already fired; decode is belt-and-suspenders */
        }
        cache.set(assetUrl, img);
      }
    }),
  );
  return cache;
}
