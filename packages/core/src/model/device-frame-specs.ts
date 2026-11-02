// SPDX-License-Identifier: Apache-2.0
import type { DeviceFrameShadowRecipe, DeviceFrameSpec } from "./device-frame-types.js";

export const legacySpecs = {
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

export const phoneDarkSpec = {
  aspectRatio: 6 / 13,
  bezelColor: "#151518",
  frameCornerRadius: 0.14,
  slotInset: { top: 0.026, right: 0.032, bottom: 0.026, left: 0.032 },
  slotCornerRadius: 0.1,
} satisfies DeviceFrameSpec;

export const phoneLightSpec = {
  ...phoneDarkSpec,
  bezelColor: "#E8E8EA",
} satisfies DeviceFrameSpec;

export const phonePunchHoleSpec = {
  aspectRatio: 0.48,
  bezelColor: "#18191C",
  frameCornerRadius: 0.11,
  slotInset: { top: 0.024, right: 0.026, bottom: 0.024, left: 0.026 },
  slotCornerRadius: 0.075,
} satisfies DeviceFrameSpec;

export const phoneOutlineSpec = {
  aspectRatio: 6 / 13,
  bezelColor: "#00000000",
  frameCornerRadius: 0.14,
  slotInset: { top: 0.02, right: 0.02, bottom: 0.02, left: 0.02 },
  slotCornerRadius: 0.105,
} satisfies DeviceFrameSpec;

export const framelessPhoneSpec = {
  aspectRatio: 6 / 13,
  bezelColor: "#00000000",
  frameCornerRadius: 0.105,
  slotInset: { top: 0, right: 0, bottom: 0, left: 0 },
  slotCornerRadius: 0.105,
} satisfies DeviceFrameSpec;

export const tabletLightSpec = {
  aspectRatio: 0.75,
  bezelColor: "#E6E7E9",
  frameCornerRadius: 0.055,
  slotInset: { top: 0.028, right: 0.028, bottom: 0.028, left: 0.028 },
  slotCornerRadius: 0.025,
} satisfies DeviceFrameSpec;

export const tabletDarkSpec = {
  ...tabletLightSpec,
  bezelColor: "#202124",
} satisfies DeviceFrameSpec;

export const tabletOutlineSpec = {
  aspectRatio: 0.75,
  bezelColor: "#00000000",
  frameCornerRadius: 0.055,
  slotInset: { top: 0.018, right: 0.018, bottom: 0.018, left: 0.018 },
  slotCornerRadius: 0.03,
} satisfies DeviceFrameSpec;

export const framelessTabletSpec = {
  aspectRatio: 0.75,
  bezelColor: "#00000000",
  frameCornerRadius: 0.03,
  slotInset: { top: 0, right: 0, bottom: 0, left: 0 },
  slotCornerRadius: 0.03,
} satisfies DeviceFrameSpec;

export const browserLightSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#ECEFF3",
  frameCornerRadius: 0.025,
  slotInset: { top: 0.08, right: 0.012, bottom: 0.018, left: 0.012 },
  slotCornerRadius: 0.008,
} satisfies DeviceFrameSpec;

export const browserDarkSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#25262B",
  frameCornerRadius: 0.025,
  slotInset: { top: 0.08, right: 0.012, bottom: 0.018, left: 0.012 },
  slotCornerRadius: 0.008,
} satisfies DeviceFrameSpec;

export const browserMinimalSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#F5F6F8",
  frameCornerRadius: 0.018,
  slotInset: { top: 0.055, right: 0.008, bottom: 0.01, left: 0.008 },
  slotCornerRadius: 0.006,
} satisfies DeviceFrameSpec;

export const framelessBrowserSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#00000000",
  frameCornerRadius: 0.015,
  slotInset: { top: 0, right: 0, bottom: 0, left: 0 },
  slotCornerRadius: 0.015,
} satisfies DeviceFrameSpec;

export const laptopSilverSpec = {
  aspectRatio: 16 / 10,
  bezelColor: "#C9CDD2",
  frameCornerRadius: 0.022,
  slotInset: { top: 0.035, right: 0.03, bottom: 0.075, left: 0.03 },
  slotCornerRadius: 0.01,
} satisfies DeviceFrameSpec;

export const laptopDarkSpec = {
  ...laptopSilverSpec,
  bezelColor: "#1B1C20",
} satisfies DeviceFrameSpec;

export const displayStandSpec = {
  aspectRatio: 16 / 9,
  bezelColor: "#202124",
  frameCornerRadius: 0.018,
  slotInset: { top: 0.025, right: 0.025, bottom: 0.055, left: 0.025 },
  slotCornerRadius: 0.008,
} satisfies DeviceFrameSpec;

export const displayMinimalSpec = {
  aspectRatio: 16 / 9,
  bezelColor: "#00000000",
  frameCornerRadius: 0.012,
  slotInset: { top: 0.012, right: 0.012, bottom: 0.012, left: 0.012 },
  slotCornerRadius: 0.008,
} satisfies DeviceFrameSpec;

export const tvFlatSpec = {
  aspectRatio: 16 / 9,
  bezelColor: "#18191C",
  frameCornerRadius: 0.008,
  slotInset: { top: 0.018, right: 0.018, bottom: 0.03, left: 0.018 },
  slotCornerRadius: 0.004,
} satisfies DeviceFrameSpec;

export const watchRoundedSpec = {
  aspectRatio: 1,
  bezelColor: "#202124",
  frameCornerRadius: 0.32,
  slotInset: { top: 0.055, right: 0.055, bottom: 0.055, left: 0.055 },
  slotCornerRadius: 0.28,
} satisfies DeviceFrameSpec;

export const watchSquareSpec = {
  aspectRatio: 1,
  bezelColor: "#202124",
  frameCornerRadius: 0.23,
  slotInset: { top: 0.045, right: 0.055, bottom: 0.045, left: 0.055 },
  slotCornerRadius: 0.18,
} satisfies DeviceFrameSpec;

export const framelessWatchSpec = {
  aspectRatio: 1,
  bezelColor: "#00000000",
  frameCornerRadius: 0,
  slotInset: { top: 0, right: 0, bottom: 0, left: 0 },
  slotCornerRadius: 0,
} satisfies DeviceFrameSpec;

export const foldableSpec = {
  aspectRatio: 0.82,
  bezelColor: "#222328",
  frameCornerRadius: 0.055,
  slotInset: { top: 0.025, right: 0.035, bottom: 0.025, left: 0.035 },
  slotCornerRadius: 0.035,
} satisfies DeviceFrameSpec;

export const foldableTallSpec = {
  aspectRatio: 0.714,
  bezelColor: "#222328",
  frameCornerRadius: 0.05,
  slotInset: { top: 0.018, right: 0.025, bottom: 0.018, left: 0.025 },
  slotCornerRadius: 0.035,
} satisfies DeviceFrameSpec;

export const phoneFlipSpec = {
  aspectRatio: 0.44,
  bezelColor: "#18191C",
  frameCornerRadius: 0.12,
  slotInset: { top: 0.0175, right: 0.03, bottom: 0.0175, left: 0.03 },
  slotCornerRadius: 0.09,
} satisfies DeviceFrameSpec;

export const automotiveDisplaySpec = {
  aspectRatio: 16 / 7,
  bezelColor: "#202124",
  frameCornerRadius: 0.045,
  slotInset: { top: 0.045, right: 0.022, bottom: 0.045, left: 0.022 },
  slotCornerRadius: 0.025,
} satisfies DeviceFrameSpec;

export const xrViewportSpec = {
  aspectRatio: 16 / 9,
  bezelColor: "#00000000",
  frameCornerRadius: 0.08,
  slotInset: { top: 0, right: 0, bottom: 0, left: 0 },
  slotCornerRadius: 0.08,
} satisfies DeviceFrameSpec;

export const shadow: DeviceFrameShadowRecipe = {
  color: "#000000",
  opacity: 0.24,
  blurFrac: 0.035,
  offsetXFrac: 0,
  offsetYFrac: 0.018,
};
