// SPDX-License-Identifier: Apache-2.0
import type { ImageCache } from "@screenshot-studio/core/engine";
import { elementLeaves, getLayout, type Project } from "@screenshot-studio/core/model";

/**
 * Browser-side image preloading — the asset analog of core/fonts (docs/architecture.md). The
 * render must not be captured until every image has decoded, or headless export can capture a
 * blank frame. Callers must await loadProjectImages before rendering and before setting
 * window.__stageReady.
 *
 * `core` stays network-agnostic: the host injects `resolve` (assetUrl -> a loadable, same-origin
 * URL). A failed asset is simply absent from the cache — the map renders a placeholder, the render
 * still completes.
 */
export type { ImageCache } from "@screenshot-studio/core/engine";

/** Every distinct raster assetUrl in the selected project scope. Pure. */
export function collectImageUrls(
  project: Project,
  layoutId?: string,
  screenIds?: readonly string[],
): string[] {
  const urls = new Set<string>();
  const layouts = layoutId ? [getLayout(project, layoutId)] : project.layouts;
  const selectedScreenIds = screenIds ? new Set(screenIds) : null;
  for (const layout of layouts) {
    for (const screen of layout.screens) {
      if (selectedScreenIds && !selectedScreenIds.has(screen.id)) continue;
      if (screen.background.type === "image") urls.add(screen.background.assetUrl);
      for (const el of screen.elements) {
        for (const leaf of elementLeaves(el)) {
          if (leaf.type === "screenshot" || leaf.type === "image" || leaf.type === "device-frame") {
            if (leaf.assetUrl) urls.add(leaf.assetUrl);
          }
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

/** Load one project image, preserving its document asset URL as the caller-owned cache key. */
export async function loadProjectImage(
  assetUrl: string,
  resolve: (assetUrl: string) => string,
): Promise<HTMLImageElement | null> {
  const image = await loadOne(resolve(assetUrl));
  if (!image) return null;
  try {
    await image.decode();
  } catch {
    /* onload already fired; decode is belt-and-suspenders */
  }
  return image;
}

/** Load and decode every screenshot image, keyed by the document assetUrl. Failed assets omitted. */
export async function loadProjectImages(
  project: Project,
  layoutId: string,
  resolve: (assetUrl: string) => string,
  screenIds?: readonly string[],
): Promise<ImageCache> {
  const cache: ImageCache = new Map();
  await Promise.all(
    collectImageUrls(project, layoutId, screenIds).map(async (assetUrl) => {
      const img = await loadProjectImage(assetUrl, resolve);
      if (img) {
        cache.set(assetUrl, img);
      }
    }),
  );
  return cache;
}
