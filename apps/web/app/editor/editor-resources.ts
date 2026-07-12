// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { parseProject, type Project } from "@screenshot-studio/core/model";
import { registerProjectFonts } from "@screenshot-studio/core/fonts";
import { collectImageUrls, loadProjectImages, type ImageCache } from "@screenshot-studio/core/assets";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { editorStore } from "../../lib/editor-store";

const resolveAsset = (assetUrl: string) => `/api/asset?path=${encodeURIComponent(assetUrl)}`;

export function missingImageUrls(project: Project, images: ImageCache): string[] {
  return collectImageUrls(project).filter((assetUrl) => !images.has(assetUrl));
}

export function useEditorResources() {
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<ImageCache | null>(null);
  const [specs, setSpecs] = useState<StoreSpecs | null>(null);
  const assetSignature = useStore(editorStore, (state) =>
    state.project ? collectImageUrls(state.project).sort().join("\n") : "",
  );

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/project");
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Failed to load project");
        const project = parseProject(body);
        const [, cache] = await Promise.all([
          // Fonts and images must resolve before the first editor paint to preserve render parity.
          registerProjectFonts(project.fonts, resolveAsset),
          loadProjectImages(project, resolveAsset),
        ]);
        editorStore.getState().load(project);
        setImages(cache);
        const specsResponse = await fetch("/api/store-specs");
        if (specsResponse.ok) setSpecs(await specsResponse.json());
      } catch (error) {
        setError((error as Error).message);
      }
    })();
  }, []);

  useEffect(() => {
    if (!images || !assetSignature) return;
    const project = editorStore.getState().project;
    if (!project) return;
    const missing = missingImageUrls(project, images);
    if (missing.length === 0) return;
    let cancelled = false;
    void loadProjectImages(project, resolveAsset).then((loaded) => {
      if (cancelled) return;
      setImages((current) => {
        if (!current) return loaded;
        const next = new Map(current);
        let changed = false;
        for (const assetUrl of missing) {
          const image = loaded.get(assetUrl);
          if (image) {
            next.set(assetUrl, image);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    });
    return () => { cancelled = true; };
  }, [assetSignature, images]);

  return { error, images, specs };
}
