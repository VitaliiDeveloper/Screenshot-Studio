// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useRef, useState } from "react";
import type { Project } from "@screenshot-studio/core/model";
import {
  ProjectFontRegistrationError,
  registerProjectFonts,
  type FontRegistrationFailure,
} from "@screenshot-studio/core/fonts";
import { editorStore } from "@web/lib/editor-store";
import { resolveActiveProjectAssetUrl } from "@web/lib/save-project";

export async function loadProjectFontWarnings(
  fonts: Project["fonts"],
  registerFonts: (fonts: Project["fonts"]) => Promise<void> = (
    projectFonts,
  ) => registerProjectFonts(projectFonts, resolveActiveProjectAssetUrl),
): Promise<FontRegistrationFailure[]> {
  try {
    await registerFonts(fonts);
    return [];
  } catch (error) {
    if (!(error instanceof ProjectFontRegistrationError)) throw error;
    return error.failures;
  }
}

export function useEditorFontWarnings(onError: (message: string) => void) {
  const [fontWarnings, setFontWarnings] = useState<FontRegistrationFailure[]>([]);
  const [fontRetrying, setFontRetrying] = useState(false);
  const generation = useRef(0);

  const reset = useCallback(() => {
    ++generation.current;
    setFontWarnings([]);
    setFontRetrying(false);
  }, []);

  const cancel = useCallback(() => {
    ++generation.current;
  }, []);

  const replace = useCallback((warnings: FontRegistrationFailure[]) => {
    setFontWarnings(warnings);
  }, []);

  const retryFonts = useCallback(() => {
    if (fontRetrying) return;
    const project = editorStore.getState().project;
    if (!project) return;
    const signature = JSON.stringify(project.fonts);
    const currentGeneration = ++generation.current;
    setFontRetrying(true);
    void loadProjectFontWarnings(project.fonts).then((warnings) => {
      if (generation.current !== currentGeneration) return;
      const current = editorStore.getState().project;
      if (!current || JSON.stringify(current.fonts) !== signature) return;
      setFontWarnings(warnings);
    }).catch((error: unknown) => {
      if (generation.current === currentGeneration) onError((error as Error).message);
    }).finally(() => {
      if (generation.current === currentGeneration) setFontRetrying(false);
    });
  }, [fontRetrying, onError]);

  return { fontWarnings, fontRetrying, reset, cancel, replace, retryFonts };
}
