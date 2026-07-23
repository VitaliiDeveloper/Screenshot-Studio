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
  readonly aspectRatio: number;
  /** Frame body fill (the bezel). */
  readonly bezelColor: string;
  /** Outer silhouette rounding, as a fraction of box width. */
  readonly frameCornerRadius: number;
  /** Screen-slot inset: left/right are fractions of box width, top/bottom of box height. */
  readonly slotInset: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  /** Screen-corner rounding, as a fraction of slot width. */
  readonly slotCornerRadius: number;
  /** Top notch/pill: width as a fraction of box width; height and top offset of box height. */
  readonly notch?: {
    readonly widthFrac: number;
    readonly heightFrac: number;
    readonly topFrac: number;
  };
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
  readonly color: string;
  readonly widthFrac: number;
  readonly insetFrac: number;
}

export interface DeviceFrameShadowRecipe {
  readonly color: string;
  readonly opacity: number;
  readonly blurFrac: number;
  readonly offsetXFrac: number;
  readonly offsetYFrac: number;
}

export interface DeviceFrameBaseRecipe {
  readonly color: string;
  readonly widthFrac: number;
  readonly heightFrac: number;
  readonly cornerRadiusFrac: number;
  readonly bottomFrac: number;
}

export interface DeviceFrameCameraRecipe {
  readonly kind: "circle" | "pill";
  readonly color: string;
  readonly xFrac: number;
  readonly yFrac: number;
  readonly widthFrac: number;
  readonly heightFrac: number;
}

export interface DeviceFrameBrowserControlsRecipe {
  readonly color: string;
  readonly count: number;
  readonly firstCenterXFrac: number;
  readonly centerYFrac: number;
  readonly radiusFrac: number;
  readonly gapFrac: number;
}

export interface DeviceFrameBrowserAddressBarRecipe {
  readonly color: string;
  readonly leftFrac: number;
  readonly rightFrac: number;
  readonly topFrac: number;
  readonly heightFrac: number;
  readonly radiusFrac: number;
}

export interface DeviceFrameBrowserChromeRecipe {
  readonly backgroundColor: string;
  readonly heightFrac: number;
  readonly controls: DeviceFrameBrowserControlsRecipe;
  readonly addressBar: DeviceFrameBrowserAddressBarRecipe;
}

/**
 * Complete deterministic input for the shared renderer, in element-box-local coordinates.
 *
 * Every `*Frac` is normalized. X, width, left/right inset, horizontal gap, blur, corner radius,
 * outline inset/stroke, and horizontal shadow offset use the element box width. Y, height,
 * top/bottom inset, and vertical shadow offset use the element box height. Slot insets are measured
 * inward from their named box edge. A legacy notch is horizontally centered, with `topFrac` measured
 * from the element top. Positive shadow offsets move right/down from the outer silhouette.
 *
 * Camera x/y are its center coordinates and camera width/height are its extents. A base is
 * horizontally centered and `bottomFrac` measures from the element bottom to the base bottom. An
 * outline is painted entirely inside the outer silhouette: `insetFrac` is the gap from the
 * silhouette edge to the stroke's outer edge and `widthFrac` extends inward.
 *
 * Browser chrome begins at the element top. Control coordinates are circle centers;
 * `firstCenterXFrac` anchors the first of `count` controls and `gapFrac` is edge-to-edge. Address-bar
 * left/right are box-edge insets and top is measured from the element top. Chrome must finish no
 * lower than the screen slot's top edge.
 *
 * Paint order is fixed: shadow of the outer silhouette; body and base; outline; screenshot or empty
 * placeholder clipped to the screen slot; then legacy notch, camera, and browser-chrome foreground
 * decorations.
 */
export interface DeviceFrameRecipe {
  readonly spec: DeviceFrameSpec;
  readonly outline?: DeviceFrameOutlineRecipe;
  readonly shadow?: DeviceFrameShadowRecipe;
  readonly base?: DeviceFrameBaseRecipe;
  readonly camera?: DeviceFrameCameraRecipe;
  readonly browserChrome?: DeviceFrameBrowserChromeRecipe;
}

/** Catalog-only presentation and rendering data; only `id` is persisted on an element. */
export interface DeviceFramePreset {
  readonly id: DeviceFrameId;
  readonly label: string;
  readonly group: DeviceFramePresetGroup;
  readonly tags: readonly DeviceFrameTag[];
  readonly finish: DeviceFrameFinish;
  readonly recommendedFor: readonly DeviceFrameRecommendation[];
  readonly legacy: boolean;
  readonly recipe: DeviceFrameRecipe;
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

const tabletDarkSpec = {
  ...tabletLightSpec,
  bezelColor: "#202124",
} satisfies DeviceFrameSpec;

const tabletOutlineSpec = {
  aspectRatio: 0.75,
  bezelColor: "#00000000",
  frameCornerRadius: 0.055,
  slotInset: { top: 0.018, right: 0.018, bottom: 0.018, left: 0.018 },
  slotCornerRadius: 0.03,
} satisfies DeviceFrameSpec;

const framelessTabletSpec = {
  aspectRatio: 0.75,
  bezelColor: "#00000000",
  frameCornerRadius: 0.03,
  slotInset: { top: 0, right: 0, bottom: 0, left: 0 },
  slotCornerRadius: 0.03,
} satisfies DeviceFrameSpec;

const browserLightSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#ECEFF3",
  frameCornerRadius: 0.025,
  slotInset: { top: 0.08, right: 0.012, bottom: 0.018, left: 0.012 },
  slotCornerRadius: 0.008,
} satisfies DeviceFrameSpec;

const browserDarkSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#25262B",
  frameCornerRadius: 0.025,
  slotInset: { top: 0.08, right: 0.012, bottom: 0.018, left: 0.012 },
  slotCornerRadius: 0.008,
} satisfies DeviceFrameSpec;

const browserMinimalSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#F5F6F8",
  frameCornerRadius: 0.018,
  slotInset: { top: 0.055, right: 0.008, bottom: 0.01, left: 0.008 },
  slotCornerRadius: 0.006,
} satisfies DeviceFrameSpec;

const framelessBrowserSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#00000000",
  frameCornerRadius: 0.015,
  slotInset: { top: 0, right: 0, bottom: 0, left: 0 },
  slotCornerRadius: 0.015,
} satisfies DeviceFrameSpec;

const laptopSilverSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#C9CDD2",
  frameCornerRadius: 0.022,
  slotInset: { top: 0.035, right: 0.03, bottom: 0.075, left: 0.03 },
  slotCornerRadius: 0.01,
} satisfies DeviceFrameSpec;

const laptopDarkSpec = {
  ...laptopSilverSpec,
  bezelColor: "#1B1C20",
} satisfies DeviceFrameSpec;

const displayStandSpec = {
  aspectRatio: 16 / 9,
  bezelColor: "#202124",
  frameCornerRadius: 0.018,
  slotInset: { top: 0.025, right: 0.025, bottom: 0.055, left: 0.025 },
  slotCornerRadius: 0.008,
} satisfies DeviceFrameSpec;

const displayMinimalSpec = {
  aspectRatio: 16 / 9,
  bezelColor: "#00000000",
  frameCornerRadius: 0.012,
  slotInset: { top: 0.012, right: 0.012, bottom: 0.012, left: 0.012 },
  slotCornerRadius: 0.008,
} satisfies DeviceFrameSpec;

const tvFlatSpec = {
  aspectRatio: 16 / 9,
  bezelColor: "#18191C",
  frameCornerRadius: 0.008,
  slotInset: { top: 0.018, right: 0.018, bottom: 0.03, left: 0.018 },
  slotCornerRadius: 0.004,
} satisfies DeviceFrameSpec;

const watchRoundedSpec = {
  aspectRatio: 1,
  bezelColor: "#202124",
  frameCornerRadius: 0.32,
  slotInset: { top: 0.055, right: 0.055, bottom: 0.055, left: 0.055 },
  slotCornerRadius: 0.28,
} satisfies DeviceFrameSpec;

const watchSquareSpec = {
  aspectRatio: 0.82,
  bezelColor: "#202124",
  frameCornerRadius: 0.23,
  slotInset: { top: 0.045, right: 0.055, bottom: 0.045, left: 0.055 },
  slotCornerRadius: 0.18,
} satisfies DeviceFrameSpec;

const framelessWatchSpec = {
  aspectRatio: 1,
  bezelColor: "#00000000",
  frameCornerRadius: 0,
  slotInset: { top: 0, right: 0, bottom: 0, left: 0 },
  slotCornerRadius: 0,
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

type DeepReadonly<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

function deepFreeze<Value>(value: Value): DeepReadonly<Value> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<Value>;
}

export const DEVICE_FRAME_PRESETS: readonly DeviceFramePreset[] = deepFreeze([
  {
    id: "iphone",
    label: "Classic Phone",
    group: "phone",
    tags: ["legacy", "classic", "phone", "dark"],
    finish: "dark",
    recommendedFor: ["mobile"],
    legacy: true,
    recipe: { spec: legacySpecs.iphone },
  },
  {
    id: "android-phone",
    label: "Classic Punch-Hole Phone",
    group: "phone",
    tags: ["legacy", "classic", "phone", "dark"],
    finish: "dark",
    recommendedFor: ["mobile"],
    legacy: true,
    recipe: { spec: legacySpecs["android-phone"] },
  },
  {
    id: "tablet",
    label: "Classic Tablet",
    group: "tablet",
    tags: ["legacy", "classic", "tablet", "dark"],
    finish: "dark",
    recommendedFor: ["tablet"],
    legacy: true,
    recipe: { spec: legacySpecs.tablet },
  },
  {
    id: "desktop",
    label: "Classic Desktop",
    group: "desktop",
    tags: ["legacy", "classic", "desktop", "dark"],
    finish: "dark",
    recommendedFor: ["desktop"],
    legacy: true,
    recipe: { spec: legacySpecs.desktop },
  },
  {
    id: "laptop",
    label: "Classic Laptop",
    group: "desktop",
    tags: ["legacy", "classic", "desktop", "dark"],
    finish: "dark",
    recommendedFor: ["desktop"],
    legacy: true,
    recipe: { spec: legacySpecs.laptop },
  },
  {
    id: "browser",
    label: "Classic Browser",
    group: "browser",
    tags: ["legacy", "classic", "browser", "light"],
    finish: "light",
    recommendedFor: ["web"],
    legacy: true,
    recipe: { spec: legacySpecs.browser },
  },
  {
    id: "tv",
    label: "Classic Television",
    group: "display",
    tags: ["legacy", "classic", "television", "dark"],
    finish: "dark",
    recommendedFor: ["television"],
    legacy: true,
    recipe: { spec: legacySpecs.tv },
  },
  {
    id: "watch",
    label: "Classic Watch",
    group: "wearable",
    tags: ["legacy", "classic", "wearable", "dark"],
    finish: "dark",
    recommendedFor: ["wearable"],
    legacy: true,
    recipe: { spec: legacySpecs.watch },
  },
  {
    id: "phone-modern-dark",
    label: "Modern Phone — Dark",
    group: "phone",
    tags: ["phone", "modern", "dark"],
    finish: "dark",
    recommendedFor: ["mobile"],
    legacy: false,
    recipe: {
      spec: phoneDarkSpec,
      shadow,
      camera: {
        kind: "pill",
        color: "#09090B",
        xFrac: 0.5,
        yFrac: 0.022,
        widthFrac: 0.25,
        heightFrac: 0.018,
      },
    },
  },
  {
    id: "phone-modern-light",
    label: "Modern Phone — Light",
    group: "phone",
    tags: ["phone", "modern", "light"],
    finish: "light",
    recommendedFor: ["mobile"],
    legacy: false,
    recipe: {
      spec: phoneLightSpec,
      shadow,
      camera: {
        kind: "pill",
        color: "#202124",
        xFrac: 0.5,
        yFrac: 0.022,
        widthFrac: 0.25,
        heightFrac: 0.018,
      },
    },
  },
  {
    id: "phone-punch-hole-dark",
    label: "Punch-Hole Phone — Dark",
    group: "phone",
    tags: ["phone", "modern", "dark"],
    finish: "dark",
    recommendedFor: ["mobile"],
    legacy: false,
    recipe: {
      spec: phonePunchHoleSpec,
      shadow,
      camera: {
        kind: "circle",
        color: "#08090A",
        xFrac: 0.5,
        yFrac: 0.018,
        widthFrac: 0.018,
        heightFrac: 0.00864,
      },
    },
  },
  {
    id: "phone-outline",
    label: "Phone Outline",
    group: "phone",
    tags: ["phone", "minimal", "outline"],
    finish: "outline",
    recommendedFor: ["mobile"],
    legacy: false,
    recipe: {
      spec: phoneOutlineSpec,
      outline: { color: "#313238", widthFrac: 0.008, insetFrac: 0.004 },
    },
  },
  {
    id: "frameless-phone",
    label: "Frameless Phone",
    group: "phone",
    tags: ["minimal", "phone", "frameless"],
    finish: "frameless",
    recommendedFor: ["mobile"],
    legacy: false,
    recipe: { spec: framelessPhoneSpec, shadow },
  },
  {
    id: "tablet-rounded-dark",
    label: "Rounded Tablet — Dark",
    group: "tablet",
    tags: ["tablet", "modern", "dark"],
    finish: "dark",
    recommendedFor: ["tablet"],
    legacy: false,
    recipe: {
      spec: tabletDarkSpec,
      shadow,
      camera: {
        kind: "circle",
        color: "#73767D",
        xFrac: 0.5,
        yFrac: 0.014,
        widthFrac: 0.008,
        heightFrac: 0.006,
      },
    },
  },
  {
    id: "tablet-rounded-light",
    label: "Rounded Tablet — Light",
    group: "tablet",
    tags: ["tablet", "modern", "light"],
    finish: "light",
    recommendedFor: ["tablet"],
    legacy: false,
    recipe: {
      spec: tabletLightSpec,
      shadow,
      camera: {
        kind: "circle",
        color: "#44464A",
        xFrac: 0.5,
        yFrac: 0.014,
        widthFrac: 0.008,
        heightFrac: 0.006,
      },
    },
  },
  {
    id: "tablet-outline",
    label: "Tablet Outline",
    group: "tablet",
    tags: ["tablet", "minimal", "outline"],
    finish: "outline",
    recommendedFor: ["tablet"],
    legacy: false,
    recipe: {
      spec: tabletOutlineSpec,
      outline: { color: "#313238", widthFrac: 0.006, insetFrac: 0.003 },
    },
  },
  {
    id: "frameless-tablet",
    label: "Frameless Tablet",
    group: "tablet",
    tags: ["tablet", "minimal", "frameless"],
    finish: "frameless",
    recommendedFor: ["tablet"],
    legacy: false,
    recipe: { spec: framelessTabletSpec, shadow },
  },
  {
    id: "browser-light",
    label: "Browser — Light",
    group: "browser",
    tags: ["browser", "modern", "light"],
    finish: "light",
    recommendedFor: ["web", "desktop"],
    legacy: false,
    recipe: {
      spec: browserLightSpec,
      shadow,
      browserChrome: {
        backgroundColor: "#ECEFF3",
        heightFrac: 0.068,
        controls: {
          color: "#9CA1AA",
          count: 3,
          firstCenterXFrac: 0.025,
          centerYFrac: 0.034,
          radiusFrac: 0.006,
          gapFrac: 0.012,
        },
        addressBar: {
          color: "#DDE0E5",
          leftFrac: 0.18,
          rightFrac: 0.025,
          topFrac: 0.018,
          heightFrac: 0.032,
          radiusFrac: 0.008,
        },
      },
    },
  },
  {
    id: "browser-dark",
    label: "Browser — Dark",
    group: "browser",
    tags: ["browser", "modern", "dark"],
    finish: "dark",
    recommendedFor: ["web", "desktop"],
    legacy: false,
    recipe: {
      spec: browserDarkSpec,
      shadow,
      browserChrome: {
        backgroundColor: "#25262B",
        heightFrac: 0.068,
        controls: {
          color: "#858992",
          count: 3,
          firstCenterXFrac: 0.025,
          centerYFrac: 0.034,
          radiusFrac: 0.006,
          gapFrac: 0.012,
        },
        addressBar: {
          color: "#34363C",
          leftFrac: 0.18,
          rightFrac: 0.025,
          topFrac: 0.018,
          heightFrac: 0.032,
          radiusFrac: 0.008,
        },
      },
    },
  },
  {
    id: "browser-minimal",
    label: "Minimal Browser",
    group: "browser",
    tags: ["browser", "minimal", "light"],
    finish: "light",
    recommendedFor: ["web", "desktop"],
    legacy: false,
    recipe: {
      spec: browserMinimalSpec,
      outline: { color: "#9CA1AA", widthFrac: 0.003, insetFrac: 0.0015 },
      browserChrome: {
        backgroundColor: "#F5F6F8",
        heightFrac: 0.05,
        controls: {
          color: "#A6AAB2",
          count: 3,
          firstCenterXFrac: 0.02,
          centerYFrac: 0.025,
          radiusFrac: 0.004,
          gapFrac: 0.009,
        },
        addressBar: {
          color: "#E3E5E9",
          leftFrac: 0.13,
          rightFrac: 0.018,
          topFrac: 0.014,
          heightFrac: 0.022,
          radiusFrac: 0.006,
        },
      },
    },
  },
  {
    id: "frameless-browser",
    label: "Frameless Browser",
    group: "browser",
    tags: ["browser", "minimal", "frameless"],
    finish: "frameless",
    recommendedFor: ["web", "desktop"],
    legacy: false,
    recipe: { spec: framelessBrowserSpec },
  },
  {
    id: "laptop-silver",
    label: "Laptop — Silver",
    group: "desktop",
    tags: ["desktop", "modern", "silver"],
    finish: "silver",
    recommendedFor: ["desktop", "web"],
    legacy: false,
    recipe: {
      spec: laptopSilverSpec,
      shadow,
      base: {
        color: "#B8BDC3",
        widthFrac: 0.98,
        heightFrac: 0.035,
        cornerRadiusFrac: 0.01,
        bottomFrac: 0,
      },
    },
  },
  {
    id: "laptop-dark",
    label: "Laptop — Dark",
    group: "desktop",
    tags: ["desktop", "modern", "dark"],
    finish: "dark",
    recommendedFor: ["desktop", "web"],
    legacy: false,
    recipe: {
      spec: laptopDarkSpec,
      shadow,
      base: {
        color: "#121317",
        widthFrac: 0.98,
        heightFrac: 0.035,
        cornerRadiusFrac: 0.01,
        bottomFrac: 0,
      },
    },
  },
  {
    id: "display-stand",
    label: "Display with Stand",
    group: "display",
    tags: ["display", "desktop", "modern", "dark"],
    finish: "dark",
    recommendedFor: ["desktop", "television"],
    legacy: false,
    recipe: {
      spec: displayStandSpec,
      shadow,
      base: {
        color: "#292B30",
        widthFrac: 0.24,
        heightFrac: 0.04,
        cornerRadiusFrac: 0.01,
        bottomFrac: 0,
      },
    },
  },
  {
    id: "display-minimal",
    label: "Minimal Display",
    group: "display",
    tags: ["display", "desktop", "television", "minimal", "outline"],
    finish: "outline",
    recommendedFor: ["desktop", "television"],
    legacy: false,
    recipe: {
      spec: displayMinimalSpec,
      outline: { color: "#414349", widthFrac: 0.004, insetFrac: 0.002 },
    },
  },
  {
    id: "tv-flat",
    label: "Flat TV",
    group: "display",
    tags: ["display", "television", "modern", "dark"],
    finish: "dark",
    recommendedFor: ["television"],
    legacy: false,
    recipe: { spec: tvFlatSpec, shadow },
  },
  {
    id: "watch-rounded",
    label: "Rounded Watch",
    group: "wearable",
    tags: ["wearable", "modern", "dark"],
    finish: "dark",
    recommendedFor: ["wearable"],
    legacy: false,
    recipe: { spec: watchRoundedSpec, shadow },
  },
  {
    id: "watch-square",
    label: "Square Watch",
    group: "wearable",
    tags: ["wearable", "modern", "dark"],
    finish: "dark",
    recommendedFor: ["wearable"],
    legacy: false,
    recipe: {
      spec: watchSquareSpec,
      shadow,
      outline: { color: "#34363A", widthFrac: 0.012, insetFrac: 0.006 },
    },
  },
  {
    id: "frameless-watch",
    label: "Frameless Watch",
    group: "wearable",
    tags: ["wearable", "minimal", "frameless"],
    finish: "frameless",
    recommendedFor: ["wearable"],
    legacy: false,
    recipe: { spec: framelessWatchSpec },
  },
  {
    id: "foldable",
    label: "Foldable Display",
    group: "foldable",
    tags: ["foldable", "mobile", "modern", "dark"],
    finish: "dark",
    recommendedFor: ["mobile", "tablet"],
    legacy: false,
    recipe: {
      spec: foldableSpec,
      shadow,
      outline: { color: "#404248", widthFrac: 0.006, insetFrac: 0.003 },
    },
  },
  {
    id: "automotive-display",
    label: "Automotive Display",
    group: "automotive",
    tags: ["automotive", "display", "modern", "dark"],
    finish: "dark",
    recommendedFor: ["automotive"],
    legacy: false,
    recipe: {
      spec: automotiveDisplaySpec,
      shadow,
      outline: { color: "#34363A", widthFrac: 0.008, insetFrac: 0.004 },
    },
  },
  {
    id: "xr-viewport",
    label: "Spatial Viewport",
    group: "spatial",
    tags: ["spatial", "frameless", "modern"],
    finish: "frameless",
    recommendedFor: ["spatial"],
    legacy: false,
    recipe: {
      spec: xrViewportSpec,
      shadow,
    },
  },
]);

const presetsById = new Map<string, DeviceFramePreset>(
  DEVICE_FRAME_PRESETS.map((preset) => [preset.id, preset]),
);

const deviceFrameSpecs = Object.fromEntries(
  DEVICE_FRAME_PRESETS.map((preset) => [preset.id, preset.recipe.spec]),
) as Record<DeviceFrameId, DeviceFrameSpec>;

export const DEVICE_FRAME_SPECS: Readonly<Record<DeviceFrameId, DeviceFrameSpec>> = deepFreeze(
  deviceFrameSpecs,
);

export interface DeviceFramePresetFilters {
  group?: DeviceFramePresetGroup;
  tags?: readonly DeviceFrameTag[];
  finish?: DeviceFrameFinish;
  recommendedFor?: readonly DeviceFrameRecommendation[];
  legacy?: boolean;
}

/** Returns presets in stable catalog order. Every supplied filter and every requested tag must match. */
export function listDeviceFramePresets(
  filters: DeviceFramePresetFilters = {},
): readonly DeviceFramePreset[] {
  return deepFreeze(DEVICE_FRAME_PRESETS.filter((preset) =>
    (filters.group === undefined || preset.group === filters.group)
    && (filters.finish === undefined || preset.finish === filters.finish)
    && (filters.legacy === undefined || preset.legacy === filters.legacy)
    && (filters.tags === undefined || filters.tags.every((tag) => preset.tags.includes(tag)))
    && (filters.recommendedFor === undefined
      || filters.recommendedFor.every((use) => preset.recommendedFor.includes(use))),
  ));
}

/** Resolves one bundled preset or throws a stable runtime error for untrusted input. */
export function deviceFramePreset(id: DeviceFrameId): DeviceFramePreset {
  const preset = presetsById.get(id);
  if (!preset) {
    throw new RangeError(`Unknown device frame preset: "${id}"`);
  }
  return preset;
}
