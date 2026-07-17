// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef, useState } from "react";
import type { Project } from "@screenshot-studio/core/model";

/**
 * Client stage: registers embedded fonts, preloads screenshot images, renders one screen via
 * `core/engine.renderScreen`, then exposes an export hook and a readiness flag on `window`. Konva
 * is imported dynamically inside the effect so it never loads during SSR (it needs a real DOM).
 *
 * Readiness contract (spec §5, §6): `window.__stageReady` is set to `true` ONLY after the embedded
 * fonts AND the screenshot images have resolved and the stage has drawn — never before — so a
 * screenshot can never capture a frame that fell back to a system font or a half-loaded image.
 */

declare global {
  interface Window {
    __stageReady?: boolean;
    __renderError?: string;
    /** Returns a PNG data URL of the current stage at the given pixelRatio. */
    __exportPng?: (pixelRatio: number) => string;
  }
}

export function RenderStage({
  project,
  layoutId,
  screenId,
  projectPath,
}: {
  project: Project;
  layoutId: string;
  screenId: string;
  projectPath: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stage: import("konva").default.Stage | undefined;
    let cancelled = false;

    (async () => {
      const container = containerRef.current;
      if (!container) return;
      try {
        const [{ renderScreen }, { registerProjectFonts }, { loadProjectImages }] = await Promise.all([
          import("@screenshot-studio/core/engine"),
          import("@screenshot-studio/core/fonts"),
          import("@screenshot-studio/core/assets"),
        ]);

        // Fonts AND images must resolve before the first paint (spec §3): a screenshot must never
        // be captured half-loaded, just like the font must never fall back.
        const resolveAsset = (assetUrl: string) =>
          `/api/asset?project=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(assetUrl)}`;
        const [, images] = await Promise.all([
          registerProjectFonts(project.fonts, resolveAsset),
          loadProjectImages(project, layoutId, resolveAsset),
        ]);
        if (cancelled) return;

        stage = renderScreen(container, project, layoutId, screenId, images);

        window.__exportPng = (pixelRatio: number) =>
          stage!.toDataURL({ pixelRatio, mimeType: "image/png" });
        window.__stageReady = true;
      } catch (err) {
        const message = (err as Error).message;
        window.__renderError = message;
        setError(message);
      }
    })();

    return () => {
      cancelled = true;
      stage?.destroy();
      delete window.__stageReady;
      delete window.__exportPng;
    };
  }, [project, layoutId, screenId, projectPath]);

  if (error) return <main data-render-error="render-failed">{error}</main>;
  return <div ref={containerRef} data-render-stage />;
}
