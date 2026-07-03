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

export const Element = z.discriminatedUnion("type", [TextElement, ShapeElement]);
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

export const Screen = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    platform: z.literal("apple"),
    device: z.literal("iphone"),
    locale: z.string().min(1),
    artboard: z
      .object({ width: z.number().int().positive(), height: z.number().int().positive() })
      .strict(),
    background: Background,
    elements: z.array(Element),
  })
  .strict();
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
