// SPDX-License-Identifier: Apache-2.0
import type { DeviceFrameId } from "./schema.js";

/**
 * Bundled device-frame geometry. All values are FRACTIONS of the element's own box, so the frame
 * scales with the element and the screen slot is always aligned to the frame body by construction —
 * there is no separate bezel asset that could drift. Native Konva shapes keep the frame vector-crisp
 * at any zoom or export pixelRatio.
 */
export interface DeviceFrameSpec {
  /** Canonical outer width / height used when switching presets. */
  aspectRatio: number;
  /** Frame body fill (the bezel). */
  bezelColor: string;
  /** Outer silhouette rounding, as a fraction of box width. */
  frameCornerRadius: number;
  /** Screen-slot inset: left/right are fractions of box width, top/bottom of box height. */
  slotInset: { top: number; right: number; bottom: number; left: number };
  /** Screen-corner rounding, as a fraction of slot width. */
  slotCornerRadius: number;
  /** Top notch/pill: width as a fraction of box width; height and top offset of box height. */
  notch?: { widthFrac: number; heightFrac: number; topFrac: number };
}

export type DeviceFramePresetGroup =
  | "phone"
  | "tablet"
  | "desktop"
  | "browser"
  | "display"
  | "wearable"
  | "foldable"
  | "automotive"
  | "spatial";

export type DeviceFrameFinish = "dark" | "light" | "silver" | "outline" | "frameless";

export type DeviceFrameRecommendation =
  | "mobile"
  | "tablet"
  | "desktop"
  | "web"
  | "television"
  | "wearable"
  | "automotive"
  | "spatial";

export type DeviceFrameTag =
  | "automotive"
  | "browser"
  | "classic"
  | "dark"
  | "desktop"
  | "display"
  | "foldable"
  | "frameless"
  | "legacy"
  | "light"
  | "minimal"
  | "mobile"
  | "modern"
  | "outline"
  | "phone"
  | "silver"
  | "spatial"
  | "tablet"
  | "television"
  | "wearable";

export interface DeviceFrameOutlineRecipe {
  color: string;
  widthFrac: number;
  insetFrac: number;
}

export interface DeviceFrameShadowRecipe {
  color: string;
  opacity: number;
  blurFrac: number;
  offsetXFrac: number;
  offsetYFrac: number;
}

export interface DeviceFrameBaseRecipe {
  color: string;
  widthFrac: number;
  heightFrac: number;
  cornerRadiusFrac: number;
  bottomFrac: number;
}

export interface DeviceFrameCameraRecipe {
  kind: "circle" | "pill";
  color: string;
  xFrac: number;
  yFrac: number;
  widthFrac: number;
  heightFrac: number;
}

export interface DeviceFrameBrowserChromeRecipe {
  backgroundColor: string;
  controlColor: string;
  heightFrac: number;
  controlRadiusFrac: number;
  controlGapFrac: number;
  addressBarColor: string;
}

/** Complete deterministic input for the shared renderer. Values ending in `Frac` are normalized. */
export interface DeviceFrameRecipe {
  spec: DeviceFrameSpec;
  outline?: DeviceFrameOutlineRecipe;
  shadow?: DeviceFrameShadowRecipe;
  base?: DeviceFrameBaseRecipe;
  camera?: DeviceFrameCameraRecipe;
  browserChrome?: DeviceFrameBrowserChromeRecipe;
}

/** Catalog-only presentation and rendering data; only `id` is persisted on an element. */
export interface DeviceFramePreset {
  id: DeviceFrameId;
  label: string;
  group: DeviceFramePresetGroup;
  tags: readonly DeviceFrameTag[];
  finish: DeviceFrameFinish;
  recommendedFor: readonly DeviceFrameRecommendation[];
  legacy: boolean;
  recipe: DeviceFrameRecipe;
}

const legacySpecs = {
  iphone: {
    aspectRatio: 6 / 13,
    bezelColor: "#1A1A1C",
    frameCornerRadius: 0.14,
    slotInset: { top: 0.028, right: 0.035, bottom: 0.028, left: 0.035 },
    slotCornerRadius: 0.1,
    notch: { widthFrac: 0.32, heightFrac: 0.018, topFrac: 0.022 },
  },
  "android-phone": { aspectRatio: 0.48, bezelColor: "#202124", frameCornerRadius: 0.11, slotInset: { top: 0.024, right: 0.028, bottom: 0.024, left: 0.028 }, slotCornerRadius: 0.075, notch: { widthFrac: 0.035, heightFrac: 0.016, topFrac: 0.012 } },
  tablet: { aspectRatio: 0.75, bezelColor: "#242426", frameCornerRadius: 0.055, slotInset: { top: 0.035, right: 0.035, bottom: 0.035, left: 0.035 }, slotCornerRadius: 0.025 },
  desktop: { aspectRatio: 1.6, bezelColor: "#25262A", frameCornerRadius: 0.025, slotInset: { top: 0.035, right: 0.025, bottom: 0.08, left: 0.025 }, slotCornerRadius: 0.012 },
  laptop: { aspectRatio: 16 / 10, bezelColor: "#202124", frameCornerRadius: 0.022, slotInset: { top: 0.035, right: 0.03, bottom: 0.075, left: 0.03 }, slotCornerRadius: 0.01 },
  browser: { aspectRatio: 16 / 10, bezelColor: "#D1D5DB", frameCornerRadius: 0.025, slotInset: { top: 0.08, right: 0.012, bottom: 0.018, left: 0.012 }, slotCornerRadius: 0.008 },
  tv: { aspectRatio: 16 / 9, bezelColor: "#17181B", frameCornerRadius: 0.018, slotInset: { top: 0.025, right: 0.025, bottom: 0.055, left: 0.025 }, slotCornerRadius: 0.008 },
  watch: { aspectRatio: 0.82, bezelColor: "#1E1E20", frameCornerRadius: 0.23, slotInset: { top: 0.045, right: 0.055, bottom: 0.045, left: 0.055 }, slotCornerRadius: 0.18 },
} as const satisfies Record<string, DeviceFrameSpec>;

const phoneDarkSpec = {
  aspectRatio: 6 / 13,
  bezelColor: "#151518",
  frameCornerRadius: 0.14,
  slotInset: { top: 0.026, right: 0.032, bottom: 0.026, left: 0.032 },
  slotCornerRadius: 0.1,
} satisfies DeviceFrameSpec;

const phoneLightSpec = {
  ...phoneDarkSpec,
  bezelColor: "#E8E8EA",
} satisfies DeviceFrameSpec;

const phonePunchHoleSpec = {
  aspectRatio: 0.48,
  bezelColor: "#18191C",
  frameCornerRadius: 0.11,
  slotInset: { top: 0.024, right: 0.026, bottom: 0.024, left: 0.026 },
  slotCornerRadius: 0.075,
} satisfies DeviceFrameSpec;

const phoneOutlineSpec = {
  aspectRatio: 6 / 13,
  bezelColor: "#00000000",
  frameCornerRadius: 0.14,
  slotInset: { top: 0.02, right: 0.02, bottom: 0.02, left: 0.02 },
  slotCornerRadius: 0.105,
} satisfies DeviceFrameSpec;

const framelessPhoneSpec = {
  aspectRatio: 6 / 13,
  bezelColor: "#00000000",
  frameCornerRadius: 0.105,
  slotInset: { top: 0, right: 0, bottom: 0, left: 0 },
  slotCornerRadius: 0.105,
} satisfies DeviceFrameSpec;

const tabletLightSpec = {
  aspectRatio: 0.75,
  bezelColor: "#E6E7E9",
  frameCornerRadius: 0.055,
  slotInset: { top: 0.028, right: 0.028, bottom: 0.028, left: 0.028 },
  slotCornerRadius: 0.025,
} satisfies DeviceFrameSpec;

const browserDarkSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#25262B",
  frameCornerRadius: 0.025,
  slotInset: { top: 0.08, right: 0.012, bottom: 0.018, left: 0.012 },
  slotCornerRadius: 0.008,
} satisfies DeviceFrameSpec;

const laptopSilverSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#C9CDD2",
  frameCornerRadius: 0.022,
  slotInset: { top: 0.035, right: 0.03, bottom: 0.075, left: 0.03 },
  slotCornerRadius: 0.01,
} satisfies DeviceFrameSpec;

const displayStandSpec = {
  aspectRatio: 16 / 9,
  bezelColor: "#202124",
  frameCornerRadius: 0.018,
  slotInset: { top: 0.025, right: 0.025, bottom: 0.055, left: 0.025 },
  slotCornerRadius: 0.008,
} satisfies DeviceFrameSpec;

const watchSquareSpec = {
  aspectRatio: 0.82,
  bezelColor: "#202124",
  frameCornerRadius: 0.23,
  slotInset: { top: 0.045, right: 0.055, bottom: 0.045, left: 0.055 },
  slotCornerRadius: 0.18,
} satisfies DeviceFrameSpec;

const foldableSpec = {
  aspectRatio: 0.82,
  bezelColor: "#222328",
  frameCornerRadius: 0.055,
  slotInset: { top: 0.025, right: 0.035, bottom: 0.025, left: 0.035 },
  slotCornerRadius: 0.035,
} satisfies DeviceFrameSpec;

const automotiveDisplaySpec = {
  aspectRatio: 16 / 7,
  bezelColor: "#202124",
  frameCornerRadius: 0.045,
  slotInset: { top: 0.045, right: 0.022, bottom: 0.045, left: 0.022 },
  slotCornerRadius: 0.025,
} satisfies DeviceFrameSpec;

const xrViewportSpec = {
  aspectRatio: 16 / 9,
  bezelColor: "#00000000",
  frameCornerRadius: 0.08,
  slotInset: { top: 0, right: 0, bottom: 0, left: 0 },
  slotCornerRadius: 0.08,
} satisfies DeviceFrameSpec;

const shadow: DeviceFrameShadowRecipe = {
  color: "#000000",
  opacity: 0.24,
  blurFrac: 0.035,
  offsetXFrac: 0,
  offsetYFrac: 0.018,
};

export const DEVICE_FRAME_PRESETS: readonly DeviceFramePreset[] = [
  { id: "iphone", label: "Classic Phone", group: "phone", tags: ["legacy", "classic", "phone", "dark"], finish: "dark", recommendedFor: ["mobile"], legacy: true, recipe: { spec: legacySpecs.iphone } },
  { id: "android-phone", label: "Classic Punch-Hole Phone", group: "phone", tags: ["legacy", "classic", "phone", "dark"], finish: "dark", recommendedFor: ["mobile"], legacy: true, recipe: { spec: legacySpecs["android-phone"] } },
  { id: "tablet", label: "Classic Tablet", group: "tablet", tags: ["legacy", "classic", "tablet", "dark"], finish: "dark", recommendedFor: ["tablet"], legacy: true, recipe: { spec: legacySpecs.tablet } },
  { id: "desktop", label: "Classic Desktop", group: "desktop", tags: ["legacy", "classic", "desktop", "dark"], finish: "dark", recommendedFor: ["desktop"], legacy: true, recipe: { spec: legacySpecs.desktop } },
  { id: "laptop", label: "Classic Laptop", group: "desktop", tags: ["legacy", "classic", "desktop", "dark"], finish: "dark", recommendedFor: ["desktop"], legacy: true, recipe: { spec: legacySpecs.laptop } },
  { id: "browser", label: "Classic Browser", group: "browser", tags: ["legacy", "classic", "browser", "light"], finish: "light", recommendedFor: ["web"], legacy: true, recipe: { spec: legacySpecs.browser } },
  { id: "tv", label: "Classic Television", group: "display", tags: ["legacy", "classic", "television", "dark"], finish: "dark", recommendedFor: ["television"], legacy: true, recipe: { spec: legacySpecs.tv } },
  { id: "watch", label: "Classic Watch", group: "wearable", tags: ["legacy", "classic", "wearable", "dark"], finish: "dark", recommendedFor: ["wearable"], legacy: true, recipe: { spec: legacySpecs.watch } },
  { id: "phone-modern-dark", label: "Modern Phone — Dark", group: "phone", tags: ["phone", "modern", "dark"], finish: "dark", recommendedFor: ["mobile"], legacy: false, recipe: { spec: phoneDarkSpec, shadow, camera: { kind: "pill", color: "#09090B", xFrac: 0.5, yFrac: 0.022, widthFrac: 0.25, heightFrac: 0.018 } } },
  { id: "phone-modern-light", label: "Modern Phone — Light", group: "phone", tags: ["phone", "modern", "light"], finish: "light", recommendedFor: ["mobile"], legacy: false, recipe: { spec: phoneLightSpec, shadow, camera: { kind: "pill", color: "#202124", xFrac: 0.5, yFrac: 0.022, widthFrac: 0.25, heightFrac: 0.018 } } },
  { id: "phone-punch-hole-dark", label: "Punch-Hole Phone — Dark", group: "phone", tags: ["phone", "modern", "dark"], finish: "dark", recommendedFor: ["mobile"], legacy: false, recipe: { spec: phonePunchHoleSpec, shadow, camera: { kind: "circle", color: "#08090A", xFrac: 0.5, yFrac: 0.018, widthFrac: 0.018, heightFrac: 0.018 } } },
  { id: "phone-outline", label: "Phone Outline", group: "phone", tags: ["phone", "minimal", "outline"], finish: "outline", recommendedFor: ["mobile"], legacy: false, recipe: { spec: phoneOutlineSpec, outline: { color: "#313238", widthFrac: 0.008, insetFrac: 0.004 } } },
  { id: "frameless-phone", label: "Frameless Phone", group: "phone", tags: ["minimal", "phone", "frameless"], finish: "frameless", recommendedFor: ["mobile"], legacy: false, recipe: { spec: framelessPhoneSpec, shadow } },
  { id: "tablet-rounded-light", label: "Rounded Tablet — Light", group: "tablet", tags: ["tablet", "modern", "light"], finish: "light", recommendedFor: ["tablet"], legacy: false, recipe: { spec: tabletLightSpec, shadow, camera: { kind: "circle", color: "#44464A", xFrac: 0.5, yFrac: 0.014, widthFrac: 0.008, heightFrac: 0.008 } } },
  { id: "browser-dark", label: "Browser — Dark", group: "browser", tags: ["browser", "modern", "dark"], finish: "dark", recommendedFor: ["web", "desktop"], legacy: false, recipe: { spec: browserDarkSpec, shadow, browserChrome: { backgroundColor: "#25262B", controlColor: "#858992", heightFrac: 0.068, controlRadiusFrac: 0.006, controlGapFrac: 0.012, addressBarColor: "#34363C" } } },
  { id: "laptop-silver", label: "Laptop — Silver", group: "desktop", tags: ["desktop", "modern", "silver"], finish: "silver", recommendedFor: ["desktop", "web"], legacy: false, recipe: { spec: laptopSilverSpec, shadow, base: { color: "#B8BDC3", widthFrac: 0.98, heightFrac: 0.035, cornerRadiusFrac: 0.01, bottomFrac: 0 } } },
  { id: "display-stand", label: "Display with Stand", group: "display", tags: ["display", "desktop", "modern", "dark"], finish: "dark", recommendedFor: ["desktop", "television"], legacy: false, recipe: { spec: displayStandSpec, shadow, base: { color: "#292B30", widthFrac: 0.24, heightFrac: 0.04, cornerRadiusFrac: 0.012, bottomFrac: 0 } } },
  { id: "watch-square", label: "Square Watch", group: "wearable", tags: ["wearable", "modern", "dark"], finish: "dark", recommendedFor: ["wearable"], legacy: false, recipe: { spec: watchSquareSpec, shadow, outline: { color: "#34363A", widthFrac: 0.012, insetFrac: 0.006 } } },
  { id: "foldable", label: "Foldable Display", group: "foldable", tags: ["foldable", "mobile", "modern", "dark"], finish: "dark", recommendedFor: ["mobile", "tablet"], legacy: false, recipe: { spec: foldableSpec, shadow, outline: { color: "#404248", widthFrac: 0.006, insetFrac: 0.003 } } },
  { id: "automotive-display", label: "Automotive Display", group: "automotive", tags: ["automotive", "display", "modern", "dark"], finish: "dark", recommendedFor: ["automotive"], legacy: false, recipe: { spec: automotiveDisplaySpec, shadow, outline: { color: "#34363A", widthFrac: 0.008, insetFrac: 0.004 } } },
  { id: "xr-viewport", label: "Spatial Viewport", group: "spatial", tags: ["spatial", "frameless", "modern"], finish: "frameless", recommendedFor: ["spatial"], legacy: false, recipe: { spec: xrViewportSpec, shadow, outline: { color: "#C7D4E8", widthFrac: 0.006, insetFrac: 0.003 } } },
];

const presetsById = new Map<string, DeviceFramePreset>(
  DEVICE_FRAME_PRESETS.map((preset) => [preset.id, preset]),
);

export const DEVICE_FRAME_SPECS = Object.fromEntries(
  DEVICE_FRAME_PRESETS.map((preset) => [preset.id, preset.recipe.spec]),
) as Record<DeviceFrameId, DeviceFrameSpec>;

export interface DeviceFramePresetFilters {
  group?: DeviceFramePresetGroup;
  tags?: readonly DeviceFrameTag[];
  finish?: DeviceFrameFinish;
  recommendedFor?: readonly DeviceFrameRecommendation[];
  legacy?: boolean;
}

/** Returns presets in stable catalog order. Every supplied filter and every requested tag must match. */
export function listDeviceFramePresets(filters: DeviceFramePresetFilters = {}): DeviceFramePreset[] {
  return DEVICE_FRAME_PRESETS.filter((preset) =>
    (filters.group === undefined || preset.group === filters.group)
    && (filters.finish === undefined || preset.finish === filters.finish)
    && (filters.legacy === undefined || preset.legacy === filters.legacy)
    && (filters.tags === undefined || filters.tags.every((tag) => preset.tags.includes(tag)))
    && (filters.recommendedFor === undefined
      || filters.recommendedFor.every((use) => preset.recommendedFor.includes(use))),
  );
}

/** Resolves one bundled preset or throws a stable runtime error for untrusted input. */
export function deviceFramePreset(id: DeviceFrameId): DeviceFramePreset {
  const preset = presetsById.get(id);
  if (!preset) {
    throw new RangeError(`Unknown device frame preset: "${id}"`);
  }
  return preset;
}
