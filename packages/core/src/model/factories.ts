import type {
  DeviceFrameElement,
  ScreenshotElement,
  ShapeElement,
  TextElement,
} from "./schema.js";

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
export function createTextElement(origin: ElementOrigin = {}): TextElement {
  return {
    ...elementBase(origin, { width: 400, height: 120 }),
    type: "text",
    content: "Text",
    fontFamily: "sans-serif",
    size: 64,
    weight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: "left",
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

export interface CreateDeviceFrameElementInput extends SizedOrigin {
  assetUrl: string;
  deviceType?: DeviceFrameElement["deviceType"];
  fit?: DeviceFrameElement["fit"];
}

export function createDeviceFrameElement(input: CreateDeviceFrameElementInput): DeviceFrameElement {
  return {
    ...elementBase(input, {
      width: input.width ?? 300,
      height: input.height ?? 650,
    }),
    type: "device-frame",
    deviceType: input.deviceType ?? "iphone",
    assetUrl: input.assetUrl,
    fit: input.fit ?? "cover",
  };
}
