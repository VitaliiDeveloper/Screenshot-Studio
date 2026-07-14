// SPDX-License-Identifier: Apache-2.0
import { sameScreenGroup, type Project, type Screen } from "@screenshot-studio/core/model";

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

const PLATFORM_LABELS: Record<string, string> = {
  apple: "App Store",
  android: "Google Play",
  windows: "Microsoft Store",
};

const DEVICE_LABELS: Record<string, string> = {
  iphone: "iPhone",
  ipad: "iPad",
  macos: "macOS",
  tvos: "tvOS",
  watchos: "watchOS",
  phone: "Android phone",
  desktop: "Windows desktop",
};

export function storeOutputLabel(platform: string, device: string): string {
  return `${PLATFORM_LABELS[platform] ?? platform} · ${DEVICE_LABELS[device] ?? device}`;
}

export interface OutputFamily {
  key: string;
  label: string;
  screens: Screen[];
}

export interface WorkspaceOutputFamily extends OutputFamily {
  editing: boolean;
}

function outputFamilyKey(screen: Pick<Screen, "platform" | "device">): string {
  return `${screen.platform}/${screen.device}`;
}

/** Preserve project order while separating independent output families into canvas rows. */
export function groupScreensByOutput(screens: readonly Screen[]): OutputFamily[] {
  const rows: OutputFamily[] = [];
  const byKey = new Map<string, OutputFamily>();
  for (const screen of screens) {
    const key = `${screen.platform}/${screen.device}`;
    let row = byKey.get(key);
    if (!row) {
      row = { key, label: storeOutputLabel(screen.platform, screen.device), screens: [] };
      byKey.set(key, row);
      rows.push(row);
    }
    row.screens.push(screen);
  }
  return rows;
}

/** Exact screens that may be selected, reordered, authored, or transformed together. */
export function workspaceEditingScope(project: Project, activeScreen: Screen): Screen[] {
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

/** Every output-family row visible in Overview for the active locale. */
export function workspaceOverviewRows(
  project: Project,
  activeScreen: Screen,
): WorkspaceOutputFamily[] {
  const families = new Map<string, Screen[]>();
  for (const screen of project.screens) {
    if (screen.locale !== activeScreen.locale) continue;
    const key = outputFamilyKey(screen);
    const screens = families.get(key) ?? [];
    screens.push(screen);
    families.set(key, screens);
  }

  const activeKey = outputFamilyKey(activeScreen);
  return Array.from(families, ([key, familyScreens]) => {
    const editing = key === activeKey;
    const roots = familyScreens.filter((screen) => screen.storeTargetId === undefined);
    const anchor = editing ? activeScreen : roots[0] ?? familyScreens[0]!;
    const screens = editing || roots.length === 0
      ? project.screens.filter((screen) => sameScreenGroup(screen, anchor))
      : roots;
    const targetId = screens[0]?.storeTargetId;
    const familyLabel = storeOutputLabel(anchor.platform, anchor.device);

    return {
      key,
      label: targetId ? `${familyLabel} · ${targetId}` : familyLabel,
      screens,
      editing,
    };
  });
}

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
    label: "Device Frame",
    category: "Frames",
    action: "open-asset-picker",
    hint: "Choose a screenshot asset; phone, tablet, desktop, TV, or watch",
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
