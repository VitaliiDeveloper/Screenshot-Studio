// SPDX-License-Identifier: Apache-2.0
/**
 * Bundled device-frame geometry (docs/specs/2026-07-04-phase1-slice3-device-frame-design.md §3). All
 * values are FRACTIONS of the element's own box, so the frame scales with the element and the screen
 * slot is always aligned to the frame body by construction — there is no separate bezel asset that
 * could drift. The frame is drawn with native Konva shapes (spec §9), so it stays vector-crisp at any
 * zoom or export pixelRatio.
 */
export interface DeviceFrameSpec {
  /** Frame body fill (the bezel). */
  bezelColor: string;
  /** Outer silhouette rounding, as a fraction of box width. */
  frameCornerRadius: number;
  /** Screen-slot inset: left/right are fractions of box width, top/bottom of box height. */
  slotInset: { top: number; right: number; bottom: number; left: number };
  /** Screen-corner rounding, as a fraction of slot width. */
  slotCornerRadius: number;
  /** Top notch/pill: width as a fraction of box width; height and top offset of box height. */
  notch: { widthFrac: number; heightFrac: number; topFrac: number };
}

export const DEVICE_FRAME_SPECS: Record<"iphone", DeviceFrameSpec> = {
  iphone: {
    bezelColor: "#1A1A1C",
    frameCornerRadius: 0.14,
    slotInset: { top: 0.028, right: 0.035, bottom: 0.028, left: 0.035 },
    slotCornerRadius: 0.1,
    notch: { widthFrac: 0.32, heightFrac: 0.018, topFrac: 0.022 },
  },
};
