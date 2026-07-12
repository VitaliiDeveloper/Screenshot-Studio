// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { fontIdentityKey } from "./font-identity.js";

/**
 * Enforced project schema (v10). Narrower than the long-term target in docs/architecture.md §3:
 * solid, linear-gradient, and project-image backgrounds; leaf types `text` | `shape` | `screenshot` | `image` | `icon` | `device-frame` plus one-level groups
 * (trusted built-in frame presets only); store families are platform-keyed; fonts uploaded/google
 * with project-relative paths. There is no `themes` project key by design; baked theme inputs
 * live outside the render contract. Badge elements are deliberately represented as ordinary
 * groups. Objects are `.strict()` on purpose: the project JSON is the agent contract,
 * so an unknown key must fail loudly rather than be silently dropped.
 */

export const SCHEMA_VERSION = 10;

export const HexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "expected a hex color like #RRGGBB");

const unitInterval = z.number().min(0).max(1);

export const THEME_ROLES = ["heading", "body", "accent", "surface"] as const;
export const ThemeRole = z.enum(THEME_ROLES);
export type ThemeRole = z.infer<typeof ThemeRole>;

export const LayoutDirection = z.enum(["ltr", "rtl"]);
export type LayoutDirection = z.infer<typeof LayoutDirection>;

export const MediaCrop = z.object({
  x: unitInterval.default(0.5),
  y: unitInterval.default(0.5),
  zoom: z.number().finite().min(1).max(4).default(1),
}).strict();
export type MediaCrop = z.infer<typeof MediaCrop>;

export const TextShadow = z.object({
  color: HexColor,
  blur: z.number().finite().min(0).max(100).default(0),
  offsetX: z.number().finite().default(0),
  offsetY: z.number().finite().default(0),
  opacity: unitInterval.default(1),
}).strict();
export type TextShadow = z.infer<typeof TextShadow>;

export const LinearGradientPaint = z.object({
  from: HexColor,
  to: HexColor,
  angle: z.number().finite().min(0).max(360).default(0),
}).strict();
export type LinearGradientPaint = z.infer<typeof LinearGradientPaint>;

export const ShapeStroke = z.object({
  color: HexColor,
  width: z.number().finite().positive().max(100),
}).strict();
export type ShapeStroke = z.infer<typeof ShapeStroke>;

/** Project-wide authoring/render projection; exact platform/device/locale groups stay independent. */
export const CanvasMode = z.enum(["isolated", "connected"]);
export type CanvasMode = z.infer<typeof CanvasMode>;

/** Fields every element shares (docs/architecture.md §3). z-order is array order in `elements`. */
const transformBase = {
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

const leafBase = {
  ...transformBase,
  /** Optional baked-theme role. The renderer continues to consume literal element fields. */
  role: ThemeRole.optional(),
};

export const TextElement = z
  .object({
    type: z.literal("text"),
    ...leafBase,
    content: z.string(),
    fontFamily: z.string().min(1),
    size: z.number().positive(),
    weight: z.number().int().min(100).max(900).default(400),
    lineHeight: z.number().positive().default(1.2),
    letterSpacing: z.number().default(0),
    align: z.enum(["left", "center", "right"]).default("left"),
    color: HexColor,
    shadow: TextShadow.optional(),
  })
  .strict();
export type TextElement = z.infer<typeof TextElement>;

export const ShapeElement = z
  .object({
    type: z.literal("shape"),
    ...leafBase,
    kind: z.enum(["rect", "ellipse"]),
    fill: HexColor,
    radius: z.number().min(0).default(0),
    gradient: LinearGradientPaint.optional(),
    stroke: ShapeStroke.optional(),
  })
  .strict();
export type ShapeElement = z.infer<typeof ShapeElement>;

export const ScreenshotElement = z
  .object({
    type: z.literal("screenshot"),
    ...leafBase,
    /** Document-relative path to the image, served by the web-host asset route. */
    assetUrl: z.string().min(1),
    fit: z.enum(["cover", "contain"]).default("cover"),
    cornerRadius: z.number().min(0).default(0),
    crop: MediaCrop.optional(),
  })
  .strict();
export type ScreenshotElement = z.infer<typeof ScreenshotElement>;

export const ImageElement = z
  .object({
    type: z.literal("image"),
    ...leafBase,
    /** Document-relative path to an arbitrary decorative raster asset. */
    assetUrl: z.string().min(1),
    fit: z.enum(["cover", "contain"]).default("contain"),
    cornerRadius: z.number().min(0).default(0),
    crop: MediaCrop.optional(),
  })
  .strict();
export type ImageElement = z.infer<typeof ImageElement>;

export const ICON_IDS = ["check", "heart", "sparkles", "star"] as const;
export const IconId = z.enum(ICON_IDS);
export type IconId = z.infer<typeof IconId>;

export const IconElement = z
  .object({
    type: z.literal("icon"),
    ...leafBase,
    icon: IconId,
    color: HexColor,
    strokeWidth: z.number().positive().default(2),
  })
  .strict();
export type IconElement = z.infer<typeof IconElement>;

export const DEVICE_FRAME_IDS = ["iphone", "android-phone", "tablet", "desktop", "tv", "watch"] as const;
export const DeviceFrameId = z.enum(DEVICE_FRAME_IDS);
export type DeviceFrameId = z.infer<typeof DeviceFrameId>;

export const DeviceFrameElement = z
  .object({
    type: z.literal("device-frame"),
    ...leafBase,
    deviceType: DeviceFrameId,
    /** Document-relative path to the screenshot placed in the frame's screen slot. */
    assetUrl: z.string().min(1),
    fit: z.enum(["cover", "contain"]).default("cover"),
  })
  .strict();
export type DeviceFrameElement = z.infer<typeof DeviceFrameElement>;

export const LeafElement = z.discriminatedUnion("type", [
  TextElement,
  ShapeElement,
  ScreenshotElement,
  ImageElement,
  IconElement,
  DeviceFrameElement,
]);
export type LeafElement = z.infer<typeof LeafElement>;

export const GroupElement = z
  .object({
    type: z.literal("group"),
    ...transformBase,
    /** Exactly one persisted grouping level; children cannot themselves be groups. */
    children: z.array(LeafElement).min(1),
  })
  .strict();
export type GroupElement = z.infer<typeof GroupElement>;

export const Element = z.discriminatedUnion("type", [
  TextElement,
  ShapeElement,
  ScreenshotElement,
  ImageElement,
  IconElement,
  DeviceFrameElement,
  GroupElement,
]);
export type Element = z.infer<typeof Element>;

export const SolidBackground = z
  .object({
    type: z.literal("solid"),
    color: HexColor,
  })
  .strict();
export type SolidBackground = z.infer<typeof SolidBackground>;

export const LinearGradientBackground = z
  .object({
    type: z.literal("linear-gradient"),
    from: HexColor,
    to: HexColor,
    /** 0 = left-to-right; 90 = top-to-bottom. */
    angle: z.number().finite().min(0).max(360).default(0),
  })
  .strict();
export type LinearGradientBackground = z.infer<typeof LinearGradientBackground>;

export const ImageBackground = z
  .object({
    type: z.literal("image"),
    /** Document-relative path served through the project asset route. */
    assetUrl: z.string().min(1),
    fit: z.enum(["cover", "contain"]).default("cover"),
    /** Opaque fallback and contain-mode letterbox colour. */
    color: HexColor.default("#000000"),
  })
  .strict();
export type ImageBackground = z.infer<typeof ImageBackground>;

export const Background = z.discriminatedUnion("type", [
  SolidBackground,
  LinearGradientBackground,
  ImageBackground,
]);
export type Background = z.infer<typeof Background>;

/** Project-relative font file served through the same asset route as screenshots. */
export const FontAsset = z
  .object({
    family: z.string().min(1),
    source: z.enum(["uploaded", "google"]),
    /** Project-relative path to the font file, e.g. assets/fonts/inter-400.ttf. */
    path: z.string().min(1),
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
  apple: ["iphone", "ipad", "macos", "tvos", "watchos"],
  android: ["phone"],
  windows: ["desktop"],
} as const;
export type Platform = keyof typeof SCREEN_DEVICES_BY_PLATFORM;

/** Non-empty tuple of platform keys, for z.enum. Safe cast: the constant always has keys. */
const PLATFORM_VALUES = Object.keys(SCREEN_DEVICES_BY_PLATFORM) as [Platform, ...Platform[]];

/** Fields every screen shares, regardless of platform (mirrors the elementBase pattern). */
const screenBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  /** Root screen identity for an independently editable explicit store-target variant. */
  variantOf: z.string().min(1).optional(),
  /** Exact store-spec id rendered by a variant; absent on root/master screens. */
  storeTargetId: z.string().min(1).optional(),
  locale: z.string().min(1),
  direction: LayoutDirection.default("ltr"),
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

const WindowsScreen = z
  .object({
    platform: z.literal("windows"),
    device: z.enum(SCREEN_DEVICES_BY_PLATFORM.windows),
    ...screenBase,
  })
  .strict();

/** `device` is constrained by `platform`; an invalid pair (apple+phone) fails validation. */
export const Screen = z.discriminatedUnion("platform", [AppleScreen, AndroidScreen, WindowsScreen]);
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
    mode: CanvasMode,
    platforms: z.array(z.enum(PLATFORM_VALUES)).min(1),
    locales: z.array(z.string().min(1)).min(1),
    fonts: z.array(FontAsset).default([]),
    screens: z.array(Screen).min(1),
  })
  .strict()
  // `platforms` is a derived manifest: no duplicates, and its set equals the set of platforms
  // the screens actually use (not a declared superset). See the Slice 1 spec.
  .superRefine((proj, ctx) => {
    if (new Set(proj.platforms).size !== proj.platforms.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "platforms must not contain duplicates",
        path: ["platforms"],
      });
    }
    const declared = new Set(proj.platforms);
    const used = new Set(proj.screens.map((s) => s.platform));
    for (const p of declared) {
      if (!used.has(p)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `platform "${p}" is declared but no screen uses it`,
          path: ["platforms"],
        });
      }
    }
    proj.screens.forEach((s, i) => {
      if (!declared.has(s.platform)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `screen platform "${s.platform}" is not listed in platforms`,
          path: ["screens", i, "platform"],
        });
      }
    });

    if (new Set(proj.locales).size !== proj.locales.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "locales must not contain duplicates",
        path: ["locales"],
      });
    }
    const declaredLocales = new Set(proj.locales);
    const usedLocales = new Set(proj.screens.map((screen) => screen.locale));
    for (const locale of declaredLocales) {
      if (!usedLocales.has(locale)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `locale "${locale}" is declared but no screen uses it`,
          path: ["locales"],
        });
      }
    }
    proj.screens.forEach((screen, index) => {
      if (!declaredLocales.has(screen.locale)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `screen locale "${screen.locale}" is not listed in locales`,
          path: ["screens", index, "locale"],
        });
      }
    });

    const screenIds = new Set<string>();
    proj.screens.forEach((screen, index) => {
      if (screenIds.has(screen.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate screen id: "${screen.id}"`,
          path: ["screens", index, "id"],
        });
      } else {
        screenIds.add(screen.id);
      }
    });

    const screensById = new Map(proj.screens.map((screen) => [screen.id, screen] as const));
    const variantKeys = new Set<string>();
    proj.screens.forEach((screen, index) => {
      const hasVariantRoot = screen.variantOf !== undefined;
      const hasStoreTarget = screen.storeTargetId !== undefined;
      if (hasVariantRoot !== hasStoreTarget) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "variantOf and storeTargetId must be present together",
          path: ["screens", index],
        });
        return;
      }
      if (!hasVariantRoot || !screen.variantOf || !screen.storeTargetId) return;

      const root = screensById.get(screen.variantOf);
      if (!root) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `variant root "${screen.variantOf}" does not exist`,
          path: ["screens", index, "variantOf"],
        });
        return;
      }
      if (root.variantOf !== undefined || root.storeTargetId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `variant root "${screen.variantOf}" must be a root screen`,
          path: ["screens", index, "variantOf"],
        });
      }
      if (
        root.platform !== screen.platform
        || root.device !== screen.device
        || root.locale !== screen.locale
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "variant platform, device, and locale must match its root screen",
          path: ["screens", index],
        });
      }

      const key = `${screen.variantOf}\u0000${screen.storeTargetId}`;
      if (variantKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate store target variant "${screen.storeTargetId}" for root "${screen.variantOf}"`,
          path: ["screens", index, "storeTargetId"],
        });
      } else {
        variantKeys.add(key);
      }
    });

    const directionByLocale = new Map<string, LayoutDirection>();
    proj.screens.forEach((screen, index) => {
      const direction = directionByLocale.get(screen.locale);
      if (direction !== undefined && direction !== screen.direction) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `all screens in locale "${screen.locale}" must use direction "${direction}"`,
          path: ["screens", index, "direction"],
        });
      } else {
        directionByLocale.set(screen.locale, screen.direction);
      }
    });

    proj.screens.forEach((screen, screenIndex) => {
      const ids = new Set<string>();
      const register = (id: string, path: (string | number)[]) => {
        if (ids.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate element id within screen: "${id}"`,
            path: ["screens", screenIndex, ...path, "id"],
          });
        } else {
          ids.add(id);
        }
      };
      screen.elements.forEach((element, elementIndex) => {
        register(element.id, ["elements", elementIndex]);
        if (element.type === "group") {
          element.children.forEach((child, childIndex) => {
            register(child.id, ["elements", elementIndex, "children", childIndex]);
          });
        }
      });
    });

    const fontIdentityIndexes = new Map<string, number>();
    proj.fonts.forEach((font, i) => {
      const key = fontIdentityKey(font);
      const existingIndex = fontIdentityIndexes.get(key);
      if (existingIndex !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate font family and weight: "${font.family}" ${font.weight}`,
          path: ["fonts", i],
        });
      } else {
        fontIdentityIndexes.set(key, i);
      }
    });
  });
export type Project = z.infer<typeof Project>;
