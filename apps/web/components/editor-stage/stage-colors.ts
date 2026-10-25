// SPDX-License-Identifier: Apache-2.0
import { useLayoutEffect, useState } from "react";

export const STAGE_COLOR_TOKENS = {
  selection: "--editor-color-selection",
  selectionFill: "--editor-color-selection-fill",
  boundary: "--editor-color-canvas-boundary",
  snapGuide: "--editor-color-snap-guide",
  overflow: "--editor-color-warning",
  handleFill: "--editor-color-surface",
} as const;

export type StageColors = Record<keyof typeof STAGE_COLOR_TOKENS, string>;

/** Light-theme values for server rendering and tests, kept equal to `tokens.css`. */
export const DEFAULT_STAGE_COLORS: StageColors = {
  selection: "#2547f0",
  selectionFill: "rgb(37 71 240 / 12%)",
  boundary: "#9aa0ae",
  snapGuide: "rgb(255 80 160 / 85%)",
  overflow: "#e0a63c",
  handleFill: "#ffffff",
};

export function readStageColors(style: Pick<CSSStyleDeclaration, "getPropertyValue">): StageColors {
  const colors = { ...DEFAULT_STAGE_COLORS };
  for (const key of Object.keys(STAGE_COLOR_TOKENS) as Array<keyof StageColors>) {
    colors[key] = style.getPropertyValue(STAGE_COLOR_TOKENS[key]).trim() || DEFAULT_STAGE_COLORS[key];
  }
  return colors;
}

/** Konva paints on a canvas and cannot resolve CSS variables, so overlays read the tokens and follow the system theme. */
export function useStageColors(): StageColors {
  const [colors, setColors] = useState(DEFAULT_STAGE_COLORS);
  // Before paint, so a dark-theme stage never flashes light overlays.
  useLayoutEffect(() => {
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      const next = readStageColors(getComputedStyle(document.documentElement));
      setColors((current) => (Object.keys(next) as Array<keyof StageColors>).every((key) => current[key] === next[key]) ? current : next);
    };
    read();
    scheme.addEventListener("change", read);
    return () => scheme.removeEventListener("change", read);
  }, []);
  return colors;
}
