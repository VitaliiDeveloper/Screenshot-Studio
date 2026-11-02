// SPDX-License-Identifier: Apache-2.0
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
export const CANVAS_PADDING = 80;
// Fixed CSS chrome around every preview: 20px title + two 8px gaps + 20px metadata.
export const ARTBOARD_LABEL_HEIGHT = 56;
export const OVERVIEW_GAP = 48;
export const OVERVIEW_ROW_GAP = 56;
export const OUTPUT_FAMILY_LABEL_HEIGHT = 28;

export type WorkspaceView = "focus" | "overview";
export type WorkspaceTool = "select" | "hand";
export type WorkspacePanel = "structure" | "add" | "agent";
export type CanvasPattern = "dots" | "grid" | "none";
export type ResourceDialog =
  | "fonts"
  | "themes"
  | "templates"
  | "screenshot-assets"
  | "image-assets"
  | "background-assets"
  | "store-badge-assets"
  | "mockup-screenshot-assets"
  | "replace-media-asset"
  | "project-images"
  | "stores";

export type MediaAssetTarget = {
  elementId: string;
  screenId: string;
  elementType: "screenshot" | "image";
};

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(3))));
}

/**
 * Fit isolated artboards whose dimensions scale with zoom while canvas chrome stays fixed.
 * The DOM gap, outer padding, and label row are CSS pixels, so treating them as document-space
 * values makes Overview overflow after pressing Fit.
 */
export function fitArtboardsZoom(
  viewport: { width: number; height: number },
  artboards: ReadonlyArray<{ width: number; height: number }>,
  options: { gap?: number; padding?: number; labelHeight?: number } = {},
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || artboards.length === 0) return 1;

  const gap = options.gap ?? 0;
  const padding = options.padding ?? CANVAS_PADDING;
  const labelHeight = options.labelHeight ?? ARTBOARD_LABEL_HEIGHT;
  const fixedWidth = padding * 2 + gap * Math.max(0, artboards.length - 1);
  const fixedHeight = padding * 2 + labelHeight;
  const scalableWidth = artboards.reduce((sum, artboard) => sum + artboard.width, 0);
  const scalableHeight = Math.max(...artboards.map((artboard) => artboard.height));
  const availableWidth = viewport.width - fixedWidth;
  const availableHeight = viewport.height - fixedHeight;

  if (availableWidth <= 0 || availableHeight <= 0 || scalableWidth <= 0 || scalableHeight <= 0) {
    return MIN_ZOOM;
  }
  return clampZoom(Math.min(availableWidth / scalableWidth, availableHeight / scalableHeight));
}

/** Fit a two-dimensional family grid whose gaps and labels remain fixed CSS pixels. */
export function fitArtboardRowsZoom(
  viewport: { width: number; height: number },
  rows: ReadonlyArray<ReadonlyArray<{ width: number; height: number }>>,
  options: {
    columnGap?: number;
    rowGap?: number;
    padding?: number;
    labelHeight?: number;
  } = {},
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || rows.length === 0) return 1;

  const columnGap = options.columnGap ?? 0;
  const rowGap = options.rowGap ?? 0;
  const padding = options.padding ?? CANVAS_PADDING;
  const labelHeight = options.labelHeight ?? ARTBOARD_LABEL_HEIGHT;
  const maxColumns = Math.max(...rows.map((row) => row.length));
  const fixedWidth = padding * 2 + columnGap * Math.max(0, maxColumns - 1);
  const fixedHeight = padding * 2 + labelHeight * rows.length + rowGap * Math.max(0, rows.length - 1);
  const scalableWidth = Math.max(...rows.map((row) =>
    row.reduce((sum, artboard) => sum + artboard.width, 0),
  ));
  const scalableHeight = rows.reduce((sum, row) =>
    sum + Math.max(0, ...row.map((artboard) => artboard.height)),
  0);
  const availableWidth = viewport.width - fixedWidth;
  const availableHeight = viewport.height - fixedHeight;

  if (availableWidth <= 0 || availableHeight <= 0 || scalableWidth <= 0 || scalableHeight <= 0) {
    return MIN_ZOOM;
  }
  return clampZoom(Math.min(availableWidth / scalableWidth, availableHeight / scalableHeight));
}
