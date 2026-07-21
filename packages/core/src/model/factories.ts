// SPDX-License-Identifier: Apache-2.0
import type {
  DeviceFrameElement,
  ImageElement,
  IconElement,
  LayoutDirection,
  ScreenshotElement,
  ShapeElement,
  TextElement,
} from "./schema.js";
import type { FontIdentity } from "./font-identity.js";
import { DEFAULT_TEXT_FONT } from "./built-in-fonts.js";
import { DEVICE_FRAME_SPECS } from "./device-frames.js";

/** Optional top-left origin for a newly inserted element (defaults to a fixed offset). */
export interface ElementOrigin {
  x?: number;
  y?: number;
}

interface SizedOrigin extends ElementOrigin {
  width?: number;
  height?: number;
  id?: string;
}

function elementBase(origin: SizedOrigin, defaults: { width: number; height: number }) {
  return {
    id: origin.id ?? crypto.randomUUID(),
    x: origin.x ?? 100,
    y: origin.y ?? 100,
    width: origin.width ?? defaults.width,
    height: origin.height ?? defaults.height,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
  };
}

/**
 * Schema-valid default elements for insert-on-click / import. Every required field with no Zod
 * default is set explicitly. Lives in `core`, not the toolbar/CLI, so all insert paths share
 * the exact same defaults (DRY).
 */
export interface CreateTextElementInput extends ElementOrigin {
  font?: FontIdentity;
  direction?: LayoutDirection;
}

export function createTextElement(input: CreateTextElementInput): TextElement {
  const font = input.font ?? DEFAULT_TEXT_FONT;
  return {
    ...elementBase(input, { width: 400, height: 120 }),
    type: "text",
    content: "Text",
    fontFamily: font.family,
    size: 64,
    weight: font.weight,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: input.direction === "rtl" ? "right" : "left",
    verticalAlign: "top",
    color: "#000000",
  };
}

export function createShapeElement(origin: ElementOrigin = {}): ShapeElement {
  return {
    ...elementBase(origin, { width: 300, height: 300 }),
    type: "shape",
    kind: "rect",
    fill: "#3B82F6",
    radius: 0,
  };
}

export interface CreateScreenshotElementInput extends SizedOrigin {
  assetUrl: string;
  fit?: ScreenshotElement["fit"];
  cornerRadius?: number;
}

export function createScreenshotElement(input: CreateScreenshotElementInput): ScreenshotElement {
  return {
    ...elementBase(input, {
      width: input.width ?? 300,
      height: input.height ?? 300,
    }),
    type: "screenshot",
    assetUrl: input.assetUrl,
    fit: input.fit ?? "cover",
    cornerRadius: input.cornerRadius ?? 0,
  };
}

export interface CreateImageElementInput extends SizedOrigin {
  assetUrl: string;
  fit?: ImageElement["fit"];
  cornerRadius?: number;
}

export function createImageElement(input: CreateImageElementInput): ImageElement {
  return {
    ...elementBase(input, {
      width: input.width ?? 300,
      height: input.height ?? 300,
    }),
    type: "image",
    assetUrl: input.assetUrl,
    fit: input.fit ?? "contain",
    cornerRadius: input.cornerRadius ?? 0,
  };
}

export interface CreateIconElementInput extends SizedOrigin {
  icon?: IconElement["icon"];
  color?: string;
  strokeWidth?: number;
}

export function createIconElement(input: CreateIconElementInput = {}): IconElement {
  return {
    ...elementBase(input, { width: 160, height: 160 }),
    type: "icon",
    icon: input.icon ?? "star",
    color: input.color ?? "#3B82F6",
    strokeWidth: input.strokeWidth ?? 2,
  };
}

export interface CreateDeviceFrameElementInput extends SizedOrigin {
  assetUrl?: string;
  deviceType?: DeviceFrameElement["deviceType"];
  fit?: DeviceFrameElement["fit"];
}

export function createDeviceFrameElement(input: CreateDeviceFrameElementInput = {}): DeviceFrameElement {
  const deviceType = input.deviceType ?? "iphone";
  return {
    ...elementBase(input, {
      width: input.width ?? 300,
      height: input.height ?? 300 / DEVICE_FRAME_SPECS[deviceType].aspectRatio,
    }),
    type: "device-frame",
    deviceType,
    ...(input.assetUrl ? { assetUrl: input.assetUrl } : {}),
    fit: input.fit ?? "cover",
  };
}
