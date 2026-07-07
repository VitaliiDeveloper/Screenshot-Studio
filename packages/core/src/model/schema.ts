import { z } from "zod";

/**
 * Phase 0 schema subset. Only what the parity spike needs: one apple/iphone screen, a solid
 * background, and the two element types that carry the parity risk cheaply (`shape`) and
 * expensively (`text`, the hardest cross-renderer case). `screenshot`/`device-frame`/`icon`/
 * `badge`/`image` are intentionally absent until Phase 1 — adding them here would widen the
 * validator surface without helping prove parity. See docs/architecture.md §3.
 *
 * Objects are `.strict()` on purpose: the project JSON is the agent contract, so an unknown
 * key must fail loudly rather than be silently dropped.
 */

export const SCHEMA_VERSION = 1;

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "expected a hex color like #RRGGBB");

const unitInterval = z.number().min(0).max(1);

/** Fields every element shares (docs/architecture.md §3). z-order is array order in `elements`. */
const elementBase = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().default(0),
  opacity: unitInterval.default(1),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
  /** Layers-panel display label (slice 4). Metadata only — never rendered/exported. */
  name: z.string().optional(),
};

export const TextElement = z
  .object({
    type: z.literal("text"),
    ...elementBase,
    content: z.string(),
    fontFamily: z.string().min(1),
    size: z.number().positive(),
    weight: z.number().int().min(100).max(900).default(400),
    lineHeight: z.number().positive().default(1.2),
    letterSpacing: z.number().default(0),
    align: z.enum(["left", "center", "right"]).default("left"),
    color: hexColor,
  })
  .strict();
export type TextElement = z.infer<typeof TextElement>;

export const ShapeElement = z
  .object({
    type: z.literal("shape"),
    ...elementBase,
    kind: z.literal("rect"),
    fill: hexColor,
    radius: z.number().min(0).default(0),
  })
  .strict();
export type ShapeElement = z.infer<typeof ShapeElement>;

export const ScreenshotElement = z
  .object({
    type: z.literal("screenshot"),
    ...elementBase,
    /** Document-relative path to the image, served by the web-host asset route. */
    assetUrl: z.string().min(1),
    fit: z.enum(["cover", "contain"]).default("cover"),
    cornerRadius: z.number().min(0).default(0),
  })
  .strict();
export type ScreenshotElement = z.infer<typeof ScreenshotElement>;

export const DeviceFrameElement = z
  .object({
    type: z.literal("device-frame"),
    ...elementBase,
    deviceType: z.literal("iphone"),
    /** Document-relative path to the screenshot placed in the frame's screen slot. */
    assetUrl: z.string().min(1),
    fit: z.enum(["cover", "contain"]).default("cover"),
  })
  .strict();
export type DeviceFrameElement = z.infer<typeof DeviceFrameElement>;

export const Element = z.discriminatedUnion("type", [
  TextElement,
  ShapeElement,
  ScreenshotElement,
  DeviceFrameElement,
]);
export type Element = z.infer<typeof Element>;

export const SolidBackground = z
  .object({
    type: z.literal("solid"),
    color: hexColor,
  })
  .strict();
export type SolidBackground = z.infer<typeof SolidBackground>;

/** Only `solid` in Phase 0; the discriminated union leaves room for gradient/image later. */
export const Background = z.discriminatedUnion("type", [SolidBackground]);
export type Background = z.infer<typeof Background>;

/** Custom font embedded as base64 so the deck is self-contained (docs/architecture.md §5). */
export const FontAsset = z
  .object({
    family: z.string().min(1),
    source: z.literal("uploaded"),
    /** Base64 of the .woff2/.ttf/.otf bytes (no data-URL prefix). */
    data: z.string().min(1),
    weight: z.number().int().min(100).max(900).default(400),
  })
  .strict();
export type FontAsset = z.infer<typeof FontAsset>;

/**
 * Source of truth for which devices each platform allows. The schema enums below are built
 * from this, and the store-specs lockstep test compares it against store-specs.json — so the
 * pair is declared in exactly one place. Widen HERE and in store-specs.json in the same change.
 */
export const SCREEN_DEVICES_BY_PLATFORM = {
  apple: ["iphone", "ipad"],
  android: ["phone"],
} as const;
export type Platform = keyof typeof SCREEN_DEVICES_BY_PLATFORM;

/** Fields every screen shares, regardless of platform (mirrors the elementBase pattern). */
const screenBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  locale: z.string().min(1),
  artboard: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .strict(),
  background: Background,
  elements: z.array(Element),
};

const AppleScreen = z
  .object({
    platform: z.literal("apple"),
    device: z.enum(SCREEN_DEVICES_BY_PLATFORM.apple),
    ...screenBase,
  })
  .strict();

const AndroidScreen = z
  .object({
    platform: z.literal("android"),
    device: z.enum(SCREEN_DEVICES_BY_PLATFORM.android),
    ...screenBase,
  })
  .strict();

/** `device` is constrained by `platform`; an invalid pair (apple+phone) fails validation. */
export const Screen = z.discriminatedUnion("platform", [AppleScreen, AndroidScreen]);
export type Screen = z.infer<typeof Screen>;

export const Project = z
  .object({
    meta: z
      .object({
        name: z.string().min(1),
        appIcon: z.string().optional(),
        schemaVersion: z.literal(SCHEMA_VERSION),
      })
      .strict(),
    platforms: z.array(z.literal("apple")).min(1),
    locales: z.array(z.string().min(1)).min(1),
    fonts: z.array(FontAsset).default([]),
    screens: z.array(Screen).min(1),
  })
  .strict();
export type Project = z.infer<typeof Project>;
