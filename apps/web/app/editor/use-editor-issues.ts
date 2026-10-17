// SPDX-License-Identifier: Apache-2.0
"use client";

import { useMemo } from "react";
import { useStore } from "zustand";
import { textOverflows } from "@screenshot-studio/core/engine";
import { collectLayoutIssues, type ProjectIssue } from "@screenshot-studio/core/validation";
import { editorStore } from "@web/lib/editor-store";

const MAX_CACHED_MEASUREMENTS = 2000;

/**
 * Live Issues for the active layout. Text overflow is measured only once project fonts have
 * settled, so fallback-font metrics never report; results are cached by the text properties the
 * renderer lays out and dropped whenever the project's fonts change.
 */
export function useEditorIssues(fontsSettled: boolean): ProjectIssue[] {
  const project = useStore(editorStore, (state) => state.project);
  const layoutId = useStore(editorStore, (state) => state.activeLayoutId);
  const fonts = project?.fonts;
  const cache = useMemo(() => ({ fonts, results: new Map<string, boolean>() }), [fonts]);

  return useMemo(() => {
    if (!project || !layoutId) return [];
    return collectLayoutIssues(project, layoutId, fontsSettled ? {
      textOverflows: (element, screen) => {
        const key = JSON.stringify([
          screen.direction,
          element.content,
          element.fontFamily,
          element.size,
          element.weight,
          element.lineHeight,
          element.letterSpacing,
          element.width,
          element.height,
        ]);
        const cached = cache.results.get(key);
        if (cached !== undefined) return cached;
        if (cache.results.size >= MAX_CACHED_MEASUREMENTS) cache.results.clear();
        const overflows = textOverflows(element, screen.direction);
        cache.results.set(key, overflows);
        return overflows;
      },
    } : {});
  }, [cache, fontsSettled, layoutId, project]);
}
