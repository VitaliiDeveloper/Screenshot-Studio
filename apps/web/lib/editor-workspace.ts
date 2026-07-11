// SPDX-License-Identifier: Apache-2.0
import { sameScreenGroup, type Project, type Screen } from "@screenshot-studio/core/model";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
export const CANVAS_PADDING = 80;
export const ARTBOARD_LABEL_HEIGHT = 24;
export const OVERVIEW_GAP = 48;

export type WorkspaceView = "focus" | "overview";
export type WorkspaceTool = "select" | "hand";
export type WorkspacePanel = "structure" | "resources" | "add";
export type CanvasPattern = "dots" | "grid" | "none";
export type ResourceDialog =
  | "fonts"
  | "themes"
  | "templates"
  | "screenshot-assets"
  | "image-assets"
  | "background-assets"
  | "store-badge-assets"
  | "device-frame-assets";

/** Connected workspaces expose one exact group; isolated workspaces retain the locale set. */
export function workspaceScreenScope(project: Project, activeScreen: Screen): Screen[] {
  if (project.mode === "connected") {
    return project.screens.filter((screen) => sameScreenGroup(screen, activeScreen));
  }
  return project.screens.filter((screen) => {
    if (activeScreen.storeTargetId === undefined) {
      return screen.locale === activeScreen.locale && screen.storeTargetId === undefined;
    }
    return screen.platform === activeScreen.platform
      && screen.device === activeScreen.device
      && screen.locale === activeScreen.locale
      && screen.storeTargetId === activeScreen.storeTargetId;
  });
}

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(3))));
}

export function fitZoom(
  viewport: { width: number; height: number },
  content: { width: number; height: number },
  padding = 112,
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || content.width <= 0 || content.height <= 0) {
    return 1;
  }
  return clampZoom(Math.min(
    (viewport.width - padding * 2) / content.width,
    (viewport.height - padding * 2) / content.height,
  ));
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

export type AddCatalogCategory = "Basic" | "Media" | "Frames" | "Library";
export type AddCatalogAction =
  | "insert-text"
  | "insert-shape"
  | "insert-icon"
  | "insert-badge"
  | "open-templates"
  | "open-asset-picker"
  | "open-store-badge-picker"
  | "unavailable";

export interface AddCatalogItem {
  id:
    | "text" | "shape" | "icon" | "screenshot" | "image" | "device-frame"
    | "rating-badge" | "as-seen-on-badge" | "store-badge" | "components";
  label: string;
  category: AddCatalogCategory;
  action: AddCatalogAction;
  shortcut?: string;
  hint?: string;
}

/**
 * The creation shelf is data-driven so schema additions only add one descriptor + action.
 * Every action maps to an enforced element type or an explicit future placeholder.
 */
export const ADD_CATALOG: readonly AddCatalogItem[] = [
  { id: "text", label: "Text", category: "Basic", action: "insert-text", shortcut: "T" },
  { id: "shape", label: "Shape", category: "Basic", action: "insert-shape", shortcut: "R" },
  { id: "icon", label: "Icon", category: "Basic", action: "insert-icon", hint: "Editable built-in vector" },
  {
    id: "screenshot",
    label: "Screenshot",
    category: "Media",
    action: "open-asset-picker",
    hint: "Choose a project image asset",
  },
  {
    id: "image",
    label: "Image",
    category: "Media",
    action: "open-asset-picker",
    hint: "Choose a decorative project asset",
  },
  {
    id: "device-frame",
    label: "iPhone Device Frame",
    category: "Frames",
    action: "open-asset-picker",
    hint: "Choose a project screenshot asset",
  },
  {
    id: "components",
    label: "Components",
    category: "Library",
    action: "open-templates",
    shortcut: "⌘/",
    hint: "Project templates",
  },
  {
    id: "rating-badge",
    label: "Rating badge",
    category: "Library",
    action: "insert-badge",
    hint: "Editable grouped rating proof",
  },
  {
    id: "as-seen-on-badge",
    label: "As seen on badge",
    category: "Library",
    action: "insert-badge",
    hint: "Editable grouped press proof",
  },
  {
    id: "store-badge",
    label: "Store badge",
    category: "Library",
    action: "open-store-badge-picker",
    hint: "Choose an official project asset",
  },
] as const;

export const ADD_CATEGORIES: readonly AddCatalogCategory[] = ["Basic", "Media", "Frames", "Library"];

export function filterAddCatalog(query: string): AddCatalogItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...ADD_CATALOG];
  return ADD_CATALOG.filter((item) =>
    `${item.label} ${item.category} ${item.hint ?? ""}`.toLocaleLowerCase().includes(normalized),
  );
}
