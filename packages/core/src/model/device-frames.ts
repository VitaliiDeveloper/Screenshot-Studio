// SPDX-License-Identifier: Apache-2.0
import type { DeviceFrameId } from "./schema.js";

/**
 * Bundled device-frame geometry (docs/specs/2026-07-04-phase1-slice3-device-frame-design.md §3). All
 * values are FRACTIONS of the element's own box, so the frame scales with the element and the screen
 * slot is always aligned to the frame body by construction — there is no separate bezel asset that
 * could drift. The frame is drawn with native Konva shapes (spec §9), so it stays vector-crisp at any
 * zoom or export pixelRatio.
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

export const DEVICE_FRAME_SPECS: Record<DeviceFrameId, DeviceFrameSpec> = {
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
  tv: { aspectRatio: 16 / 9, bezelColor: "#17181B", frameCornerRadius: 0.018, slotInset: { top: 0.025, right: 0.025, bottom: 0.055, left: 0.025 }, slotCornerRadius: 0.008 },
  watch: { aspectRatio: 0.82, bezelColor: "#1E1E20", frameCornerRadius: 0.23, slotInset: { top: 0.045, right: 0.055, bottom: 0.045, left: 0.055 }, slotCornerRadius: 0.18 },
};
