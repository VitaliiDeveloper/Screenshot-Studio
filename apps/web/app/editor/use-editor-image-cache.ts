// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { Project } from "@screenshot-studio/core/model";
import {
  collectImageUrls,
  loadProjectImage,
  loadProjectImages,
  type ImageCache,
} from "@screenshot-studio/core/assets";
import { editorStore } from "@web/lib/editor/editor-store";
import {
  resolveActiveProjectAssetUrl,
  type ProjectAssetResolver,
} from "@web/lib/clients/save-project";
import type { CachedAssetDimensions } from "@web/components/asset-picker-model";

export async function loadAllProjectImages(
  project: Project,
  resolveAsset: ProjectAssetResolver,
): Promise<ImageCache> {
  const caches = await Promise.all(
    project.layouts.map((layout) => loadProjectImages(project, layout.id, resolveAsset)),
  );
  return new Map(caches.flatMap((cache) => [...cache]));
}

export function missingImageUrls(project: Project, images: ImageCache): string[] {
  return collectImageUrls(project).filter((assetUrl) => !images.has(assetUrl));
}

export function cacheDecodedProjectImage(
  images: ImageCache,
  assetUrl: string,
  image: HTMLImageElement,
): ImageCache {
  // Update the shared cache before publishing a new Map so a synchronous project mutation cannot
  // render one frame with a missing-image placeholder.
  images.set(assetUrl, image);
  return new Map(images);
}

export function useEditorImageCache(resourceGeneration: { readonly current: number }) {
  const [images, setImages] = useState<ImageCache | null>(null);
  const imagesRef = useRef<ImageCache | null>(null);
  const assetSignature = useStore(editorStore, (state) =>
    state.project ? collectImageUrls(state.project).sort().join("\n") : "",
  );

  const reset = useCallback(() => {
    imagesRef.current = null;
    setImages(null);
  }, []);

  const replace = useCallback((next: ImageCache) => {
    imagesRef.current = next;
    setImages(next);
  }, []);

  useEffect(() => {
    if (!images || !assetSignature) return;
    const project = editorStore.getState().project;
    if (!project) return;
    const missing = missingImageUrls(project, images);
    if (missing.length === 0) return;
    let cancelled = false;
    void loadAllProjectImages(project, resolveActiveProjectAssetUrl).then((loaded) => {
      if (cancelled) return;
      setImages((current) => {
        if (!current) {
          imagesRef.current = loaded;
          return loaded;
        }
        const next = new Map(current);
        let changed = false;
        for (const assetUrl of missing) {
          const image = loaded.get(assetUrl);
          if (image) {
            next.set(assetUrl, image);
            changed = true;
          }
        }
        const result = changed ? next : current;
        imagesRef.current = result;
        return result;
      });
    });
    return () => { cancelled = true; };
  }, [assetSignature, images]);

  const cacheImage = useCallback(async (assetUrl: string): Promise<CachedAssetDimensions | null> => {
    const generation = resourceGeneration.current;
    const current = imagesRef.current;
    if (!current) return null;
    const cached = current.get(assetUrl);
    if (cached) return { width: cached.naturalWidth, height: cached.naturalHeight };
    const image = await loadProjectImage(assetUrl, resolveActiveProjectAssetUrl);
    if (!image
      || resourceGeneration.current !== generation
      || imagesRef.current !== current) return null;
    replace(cacheDecodedProjectImage(current, assetUrl, image));
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, [replace, resourceGeneration]);

  return { images, reset, replace, cacheImage };
}
