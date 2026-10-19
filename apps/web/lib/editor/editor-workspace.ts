// SPDX-License-Identifier: Apache-2.0
import {
  DEVICE_FRAME_PRESETS,
  deviceFramePreset,
  sameScreenGroup,
  type DeviceFrameId,
  type DeviceFrameRecommendation,
  type DesignLayout,
  type Screen,
} from "@screenshot-studio/core/model";
import {
  DEFAULT_STORE_SPECS,
  destinationLabel,
  listOutputFamilies,
  outputFamilyLabel,
  type StoreSize,
  type StoreSpecs,
} from "@screenshot-studio/core/export";

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
export type WorkspacePanel = "structure" | "add";
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
  | "replace-media-asset";

export type MediaAssetTarget = {
  elementId: string;
  screenId: string;
  elementType: "screenshot" | "image";
};

type DeviceFrameScreenContext = Pick<Screen, "platform" | "device" | "artboard">;

export interface DeviceFrameContext {
  readonly insertionPresetId: DeviceFrameId;
  readonly recommendedPresetId?: DeviceFrameId;
  readonly recommendation: DeviceFrameRecommendation;
  readonly unsuitablePresetIds: readonly DeviceFrameId[];
}

const decoratedWatchPresetIds = DEVICE_FRAME_PRESETS
  .filter((preset) => preset.group === "wearable" && preset.finish !== "frameless")
  .map(({ id }) => id);

/** Transient authoring guidance; no recommendation or suitability data is persisted. */
export function deviceFrameContextForScreen(
  screen?: DeviceFrameScreenContext | null,
): DeviceFrameContext {
  if (!screen) {
    return {
      insertionPresetId: "iphone",
      recommendedPresetId: "iphone",
      recommendation: "mobile",
      unsuitablePresetIds: [],
    };
  }

  const key = `${screen.platform}/${screen.device}`;
  if (key === "android/wear") {
    return {
      insertionPresetId: "frameless-watch",
      recommendedPresetId: undefined,
      recommendation: "wearable",
      unsuitablePresetIds: decoratedWatchPresetIds,
    };
  }

  const recommendation = (() => {
    switch (key) {
      case "apple/iphone":
      case "android/phone":
      case "web/mobile":
        return ["phone-modern-dark", "mobile"] as const;
      case "apple/ipad":
      case "android/tablet-7":
      case "android/tablet-10":
      case "web/tablet":
        return ["tablet-rounded-light", "tablet"] as const;
      case "web/desktop":
        return ["browser-dark", "web"] as const;
      case "apple/macos":
      case "android/chromebook":
      case "windows/desktop":
      case "web/laptop":
        return ["laptop-silver", "desktop"] as const;
      case "apple/tvos":
      case "android/tv":
      case "windows/xbox":
        return ["display-stand", "television"] as const;
      case "apple/watchos":
        return ["watch-square", "wearable"] as const;
      case "android/automotive":
        return ["automotive-display", "automotive"] as const;
      case "apple/visionos":
      case "android/xr":
      case "windows/holographic":
        return ["xr-viewport", "spatial"] as const;
      default:
        // The strict Screen schema currently makes this unreachable. Keep an active but future
        // family on the semantic catalog instead of silently falling back to the legacy preset.
        return ["phone-modern-dark", "mobile"] as const;
    }
  })();

  return {
    insertionPresetId: recommendation[0],
    recommendedPresetId: recommendation[0],
    recommendation: recommendation[1],
    unsuitablePresetIds: [],
  };
}

export function defaultDeviceFrameInputForScreen(
  screen?: DeviceFrameScreenContext | null,
): { deviceType: DeviceFrameId; width?: number; height?: number } {
  const context = deviceFrameContextForScreen(screen);
  if (context.insertionPresetId !== "frameless-watch") {
    return { deviceType: context.insertionPresetId };
  }
  const width = 300;
  const aspectRatio = deviceFramePreset(context.insertionPresetId).recipe.spec.aspectRatio;
  return {
    deviceType: context.insertionPresetId,
    width,
    height: width / aspectRatio,
  };
}

const STORE_SIZE_DEVICE_LABELS: Record<string, string> = {
  iphone: "iPhone",
  ipad: "iPad",
  macos: "Mac",
  tvos: "Apple TV",
  watchos: "Apple Watch",
  phone: "Android phone",
  desktop: "Windows desktop",
  laptop: "Web laptop",
  tablet: "Web tablet",
  mobile: "Web mobile",
  "tablet-7": "7-inch Android tablet",
  "tablet-10": "10-inch Android tablet",
};

export function storeOutputLabel(
  platform: string,
  device: string,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): string {
  return outputFamilyLabel(platform, device, specs);
}

function capitalizeDisplayLabel(value: string): string {
  if (/^(?:iPhone|iPad|macOS|tvOS|watchOS)\b/.test(value)) return value;
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Short family copy for UI that already supplies the destination and output context. */
export function outputFamilyEditorLabel(
  platform: string,
  device: string,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): string {
  const family = listOutputFamilies(specs).find(({ key }) => key === `${platform}/${device}`);
  if (!family) return storeOutputLabel(platform, device, specs);
  const legacySuffix = /\s+\(legacy\)$/i.test(family.label) ? " (legacy)" : "";
  const base = family.label
    .replace(/\s+\(legacy\)$/i, "")
    .replace(/\bAndroid\s+/i, "")
    .replace(/\bWindows\s+/i, "");
  return `${capitalizeDisplayLabel(base)}${legacySuffix}`;
}

/** Remove output-level device copy from a size label while preserving its useful discriminator. */
export function compactStoreSizeLabel(label: string, device: string): string {
  const withoutLead = label.replace(/\s+\(lead\)$/i, "");
  if (device === "tablet-7") {
    const canonicalTabletSize = /^(\d+-inch|\d+:\d+) Android tablet(?: (.+))?$/.exec(withoutLead);
    if (canonicalTabletSize) {
      return [canonicalTabletSize[1], canonicalTabletSize[2]].filter(Boolean).join(" ");
    }
  }
  const deviceLabel = STORE_SIZE_DEVICE_LABELS[device];
  if (!deviceLabel) return withoutLead;
  return withoutLead
    .replace(new RegExp(`(?:^|\\s)${escapeRegExp(deviceLabel)}(?=\\s|$)`, "i"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Format every target as `discriminator · orientation · qualifier`.
 * The family card supplies destination/device context, so this copy never repeats it.
 */
export function conciseStoreTargetLabel(
  target: StoreSize,
  platform: string,
  device: string,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): string {
  if (target.kind === "promotion") {
    const withoutDestination = target.label.replace(
      new RegExp(`^${escapeRegExp(destinationLabel(platform, specs))}\\s+`, "i"),
      "",
    );
    return target.id === "play-feature-graphic"
      ? "Feature graphic"
      : capitalizeDisplayLabel(withoutDestination);
  }

  let compact = compactStoreSizeLabel(target.label, device);
  const family = listOutputFamilies(specs).find(({ key }) => key === `${platform}/${device}`);
  if (family) {
    const familyLabel = family.label.replace(/\s+\(legacy\)$/i, "");
    compact = compact.replace(
      new RegExp(
        `^(?:${platform === "web" ? "Web\\s+" : ""}${escapeRegExp(familyLabel)})(?:\\s+|$)`,
        "i",
      ),
      "",
    );
  }

  const qualifiers: string[] = [];
  if (/\bhigh resolution\b/i.test(compact)) qualifiers.push("High-res");
  if (/\(frameless\)/i.test(compact)) qualifiers.push("Frameless");
  const base = compact
    .replace(/\bhigh resolution\b/gi, "")
    .replace(/\s*\(frameless\)\s*/gi, " ")
    .replace(/\b(?:portrait|landscape|square)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return [
    base ? capitalizeDisplayLabel(base) : "",
    capitalizeDisplayLabel(target.orientation),
    ...qualifiers,
  ].filter(Boolean).join(" · ");
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
export function groupScreensByOutput(
  screens: readonly Screen[],
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): OutputFamily[] {
  const rows: OutputFamily[] = [];
  const byKey = new Map<string, OutputFamily>();
  for (const screen of screens) {
    const key = `${screen.platform}/${screen.device}`;
    let row = byKey.get(key);
    if (!row) {
      row = { key, label: storeOutputLabel(screen.platform, screen.device, specs), screens: [] };
      byKey.set(key, row);
      rows.push(row);
    }
    row.screens.push(screen);
  }
  return rows;
}

/** Exact screens that may be selected, reordered, authored, or transformed together. */
export function workspaceEditingScope(layout: DesignLayout, activeScreen: Screen): Screen[] {
  if (layout.mode === "connected") {
    return layout.screens.filter((screen) => sameScreenGroup(screen, activeScreen));
  }
  return layout.screens.filter((screen) => {
    if (activeScreen.storeTargetId === undefined) {
      return screen.locale === activeScreen.locale && screen.storeTargetId === undefined;
    }
    return screen.platform === activeScreen.platform
      && screen.device === activeScreen.device
      && screen.locale === activeScreen.locale
      && screen.storeTargetId === activeScreen.storeTargetId;
  });
}

/** Every independent output row visible in Overview for the active locale. */
export function workspaceOverviewRows(
  layout: DesignLayout,
  activeScreen: Screen,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): WorkspaceOutputFamily[] {
  const families = new Map<string, Screen[]>();
  for (const screen of layout.screens) {
    if (screen.locale !== activeScreen.locale) continue;
    const key = outputFamilyKey(screen);
    const screens = families.get(key) ?? [];
    screens.push(screen);
    families.set(key, screens);
  }

  if (layout.mode === "isolated") {
    return Array.from(families).flatMap(([key, familyScreens]) => {
      const roots = familyScreens.filter((screen) => screen.storeTargetId === undefined);
      const variantsByTarget = new Map<string, Screen[]>();
      for (const screen of familyScreens) {
        if (screen.storeTargetId === undefined) continue;
        const variants = variantsByTarget.get(screen.storeTargetId) ?? [];
        variants.push(screen);
        variantsByTarget.set(screen.storeTargetId, variants);
      }

      const rows: Array<{ targetId: string | undefined; screens: Screen[] }> = roots.length > 0
        ? [{ targetId: undefined, screens: roots }]
        : [];
      rows.push(...Array.from(variantsByTarget, ([targetId, screens]) => ({ targetId, screens })));
      const familyLabel = storeOutputLabel(familyScreens[0]!.platform, familyScreens[0]!.device, specs);

      return rows.map(({ targetId, screens }) => ({
        key: targetId === undefined ? key : `${key}/${targetId}`,
        label: targetId === undefined ? familyLabel : `${familyLabel} · ${targetId}`,
        screens,
        editing: screens.some((screen) => screen.id === activeScreen.id),
      }));
    });
  }

  const activeKey = outputFamilyKey(activeScreen);
  return Array.from(families, ([key, familyScreens]) => {
    const editing = key === activeKey;
    const roots = familyScreens.filter((screen) => screen.storeTargetId === undefined);
    const anchor = editing ? activeScreen : roots[0] ?? familyScreens[0]!;
    const screens = editing || roots.length === 0
      ? layout.screens.filter((screen) => sameScreenGroup(screen, anchor))
      : roots;
    const targetId = screens[0]?.storeTargetId;
    const familyLabel = storeOutputLabel(anchor.platform, anchor.device, specs);

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
  | "insert-device-frame"
  | "open-templates"
  | "open-asset-picker"
  | "open-store-badge-picker"
  | "unavailable";

export interface AddCatalogItem {
  id:
    | "text" | "shape" | "icon" | "screenshot" | "image" | "device-frame" | "device-frame-image"
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
    label: "Add device mockup",
    category: "Frames",
    action: "insert-device-frame",
    hint: "Create an empty mockup; assign or replace its local screenshot later",
  },
  {
    id: "device-frame-image",
    label: "Place screenshot in mockup",
    category: "Frames",
    action: "open-asset-picker",
    hint: "Choose a local project screenshot and create a populated mockup",
  },
  {
    id: "components",
    label: "Screen templates",
    category: "Library",
    action: "open-templates",
    shortcut: "⌘/",
    hint: "Create a screen from a project-local screen template",
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
