import type { Project } from "../model/schema.js";
import type { ImageCache } from "../engine/node-config.js";

/**
 * Browser-side image preloading — the asset analog of core/fonts (docs/architecture.md §5). Text
 * was the Phase 0 parity race; images are the Slice 2 race: the render must not be screenshotted
 * until every image has DECODED, or the headless export captures a blank frame. Callers MUST await
 * loadProjectImages before rendering and before setting window.__stageReady.
 *
 * `core` stays network-agnostic: the host injects `resolve` (assetUrl -> a loadable, same-origin
 * URL). A failed asset is simply absent from the cache — the map renders a placeholder, the render
 * still completes.
 */
export type { ImageCache } from "../engine/node-config.js";

/** Every distinct content assetUrl (screenshot + device-frame) in the project. Pure. */
export function collectImageUrls(project: Project): string[] {
  const urls = new Set<string>();
  for (const screen of project.screens) {
    for (const el of screen.elements) {
      if (el.type === "screenshot" || el.type === "device-frame") urls.add(el.assetUrl);
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
