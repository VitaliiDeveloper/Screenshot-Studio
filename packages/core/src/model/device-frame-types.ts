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
