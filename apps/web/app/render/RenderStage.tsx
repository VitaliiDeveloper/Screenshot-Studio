"use client";

import { useEffect, useRef, useState } from "react";
import type { Project } from "@screenshot-studio/core/model";

/**
 * Client stage: registers embedded fonts, renders one screen via `core/engine.renderScreen`,
 * then exposes an export hook and a readiness flag on `window`. Konva is imported dynamically
 * inside the effect so it never loads during SSR (it needs a real DOM).
 *
 * Readiness contract (spec §5, §6): `window.__stageReady` is set to `true` ONLY after the
 * embedded fonts have resolved and the stage has drawn — never before — so a screenshot can
 * never capture a frame that fell back to a system font (the #1 parity failure mode).
 */

declare global {
  interface Window {
    __stageReady?: boolean;
    __renderError?: string;
    /** Returns a PNG data URL of the current stage at the given pixelRatio. */
    __exportPng?: (pixelRatio: number) => string;
  }
}

export function RenderStage({ project, screenId }: { project: Project; screenId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stage: import("konva").default.Stage | undefined;
    let cancelled = false;

    (async () => {
      const container = containerRef.current;
      if (!container) return;
      try {
        const [{ renderScreen }, { registerProjectFonts }] = await Promise.all([
          import("@screenshot-studio/core/engine"),
          import("@screenshot-studio/core/fonts"),
        ]);

        // Fonts first — the render must paint with the embedded font, not a fallback.
        await registerProjectFonts(project.fonts);
        if (cancelled) return;

        stage = renderScreen(container, project, screenId);

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
  }, [project, screenId]);

  if (error) return <main data-render-error="render-failed">{error}</main>;
  return <div ref={containerRef} data-render-stage />;
}
