// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { fontIdentityKey } from "./font-identity.js";
import { ProjectRelativePath } from "./project-resource-path.js";

/**
 * Enforced project schema (v1). Narrower than the long-term target in docs/architecture.md:
 * solid, linear-gradient, and project-image backgrounds; leaf types `text` | `shape` | `screenshot` | `image` | `icon` | `device-frame` plus one-level groups
 * (trusted built-in frame presets only); store families are platform-keyed; fonts uploaded/google
 * with project-relative paths. There is no `themes` project key by design; baked theme inputs
 * live outside the render contract. Badge elements are deliberately represented as ordinary
 * groups. Objects are `.strict()` on purpose: the project JSON is the agent contract,
 * so an unknown key must fail loudly rather than be silently dropped.
 */

export const SCHEMA_VERSION = 1;
export const FONT_WEIGHT_MIN = 100;
export const FONT_WEIGHT_MAX = 900;
export const FONT_WEIGHT_STEP = 100;
export const DEFAULT_FONT_WEIGHT = 400;
export const TEXT_SHADOW_BLUR_MAX = 100;
export const SHAPE_STROKE_WIDTH_MAX = 100;
export const MEDIA_BLUR_MAX = 40;

export const FontWeight = z
  .number()
  .int()
  .min(FONT_WEIGHT_MIN)
  .max(FONT_WEIGHT_MAX)
  .default(DEFAULT_FONT_WEIGHT);

export const HexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "expected a hex color like #RRGGBB");

const unitInterval = z.number().min(0).max(1);

export const THEME_ROLES = ["heading", "body", "accent", "surface"] as const;
export const ThemeRole = z.enum(THEME_ROLES);
export type ThemeRole = z.infer<typeof ThemeRole>;

export const LayoutDirection = z.enum(["ltr", "rtl"]);
export type LayoutDirection = z.infer<typeof LayoutDirection>;

export const TextVerticalAlign = z.enum(["top", "middle", "bottom"]);
export type TextVerticalAlign = z.infer<typeof TextVerticalAlign>;

export const MediaCrop = z.object({
  x: unitInterval.default(0.5),
  y: unitInterval.default(0.5),
  zoom: z.number().finite().min(1).max(4).default(1),
}).strict();
export type MediaCrop = z.infer<typeof MediaCrop>;

export const TextShadow = z.object({
  color: HexColor,
  blur: z.number().finite().min(0).max(TEXT_SHADOW_BLUR_MAX).default(0),
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
  width: z.number().finite().positive().max(SHAPE_STROKE_WIDTH_MAX),
}).strict();
export type ShapeStroke = z.infer<typeof ShapeStroke>;

/** Project-wide authoring/render projection; exact platform/device/locale groups stay independent. */
export const CanvasMode = z.enum(["isolated", "connected"]);
export type CanvasMode = z.infer<typeof CanvasMode>;

/** Authoring relationship between the exact-size screen sets in one output family. */
export const ScreenSetMode = z.enum(["independent", "synchronized"]);
export type ScreenSetMode = z.infer<typeof ScreenSetMode>;

/** Fields every element shares (docs/architecture.md). z-order is array order in `elements`. */
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
  /** Optional Layers-panel display label. Metadata only — never rendered/exported. */
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
    weight: FontWeight,
    lineHeight: z.number().positive().default(1.2),
    letterSpacing: z.number().default(0),
    align: z.enum(["left", "center", "right"]).default("left"),
    /** Optional for v1 compatibility; the shared renderer treats absence as `top`. */
    verticalAlign: TextVerticalAlign.optional(),
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
    /** Portable project-relative path to the image, served by the web-host asset route. */
    assetUrl: ProjectRelativePath,
    fit: z.enum(["cover", "contain"]).default("cover"),
    cornerRadius: z.number().min(0).default(0),
    crop: MediaCrop.optional(),
    /** Gaussian blur radius in artboard pixels. Omitted and zero are visually equivalent. */
    blur: z.number().finite().min(0).max(MEDIA_BLUR_MAX).optional(),
  })
  .strict();
export type ScreenshotElement = z.infer<typeof ScreenshotElement>;

export const ImageElement = z
  .object({
    type: z.literal("image"),
    ...leafBase,
    /** Portable project-relative path to an arbitrary decorative raster asset. */
    assetUrl: ProjectRelativePath,
    fit: z.enum(["cover", "contain"]).default("contain"),
    cornerRadius: z.number().min(0).default(0),
    crop: MediaCrop.optional(),
    /** Gaussian blur radius in artboard pixels. Omitted and zero are visually equivalent. */
    blur: z.number().finite().min(0).max(MEDIA_BLUR_MAX).optional(),
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

export const DEVICE_FRAME_IDS = [
  "iphone", "android-phone", "tablet", "desktop", "laptop", "browser", "tv", "watch",
  "phone-modern-dark", "phone-modern-light", "phone-punch-hole-dark", "phone-outline",
  "frameless-phone", "tablet-rounded-dark", "tablet-rounded-light", "tablet-outline",
  "frameless-tablet", "browser-light", "browser-dark", "browser-minimal", "frameless-browser",
  "laptop-silver", "laptop-dark", "display-stand", "display-minimal", "tv-flat",
  "watch-rounded", "watch-square", "frameless-watch", "foldable", "automotive-display",
  "xr-viewport",
] as const;
export const DeviceFrameId = z.enum(DEVICE_FRAME_IDS);
export type DeviceFrameId = z.infer<typeof DeviceFrameId>;

export const DeviceFrameElement = z
  .object({
    type: z.literal("device-frame"),
    ...leafBase,
    deviceType: DeviceFrameId,
    /** Portable project-relative path to the screenshot placed in the frame's screen slot. */
    assetUrl: ProjectRelativePath.optional(),
    fit: z.enum(["cover", "contain"]).default("cover"),
    /** Gaussian blur applied only to the screenshot content, never to the device bezel. */
    blur: z.number().finite().min(0).max(MEDIA_BLUR_MAX).optional(),
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
    /** Portable project-relative path served through the project asset route. */
    assetUrl: ProjectRelativePath,
    fit: z.enum(["cover", "contain"]).default("cover"),
    /** RGB or alpha-bearing RGBA fallback and contain-mode letterbox colour. */
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

/** Portable project-relative font file served through the same asset route as screenshots. */
export const FontAsset = z
  .object({
    family: z.string().min(1),
    source: z.enum(["uploaded", "google"]),
    /** Portable project-relative path to the font file, e.g. assets/fonts/inter-400.ttf. */
    path: ProjectRelativePath,
    weight: FontWeight,
  })
  .strict();
export type FontAsset = z.infer<typeof FontAsset>;

/**
 * Source of truth for which devices each platform allows. The schema enums below are built
 * from this. The output-catalog decoder and store-specs lockstep test compare their JSON documents
 * against it. Widen HERE and both catalogs in the same coordinated change.
 */
export const SCREEN_DEVICES_BY_PLATFORM = {
  apple: ["iphone", "ipad", "macos", "tvos", "watchos", "visionos"],
  android: [
    "phone", "tablet-7", "tablet-10", "chromebook", "tv", "wear", "automotive", "xr",
  ],
  windows: ["desktop", "xbox", "holographic"],
  web: ["desktop", "laptop", "tablet", "mobile"],
} as const;
export type Platform = keyof typeof SCREEN_DEVICES_BY_PLATFORM;

/** Fields every screen shares, regardless of platform (mirrors the elementBase pattern). */
const screenBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  /** Optional primary-screen identity for an exact-target screen that participates in a slot pair. */
  variantOf: z.string().min(1).optional(),
  /** Exact store-spec id rendered by this screen; absent on primary-size screens. */
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

const WebScreen = z
  .object({
    platform: z.literal("web"),
    device: z.enum(SCREEN_DEVICES_BY_PLATFORM.web),
    ...screenBase,
  })
  .strict();

/** `device` is constrained by `platform`; an invalid pair (apple+phone) fails validation. */
export const Screen = z.discriminatedUnion("platform", [
  AppleScreen, AndroidScreen, WindowsScreen, WebScreen,
]);
export type Screen = z.infer<typeof Screen>;

const screenSetPolicyBase = {
  locale: z.string().min(1),
  mode: ScreenSetMode,
};

/** Persisted per-locale output-family authoring policy; it never changes rendered pixels. */
export const ScreenSetPolicy = z.discriminatedUnion("platform", [
  z.object({
    platform: z.literal("apple"),
    device: z.enum(SCREEN_DEVICES_BY_PLATFORM.apple),
    ...screenSetPolicyBase,
  }).strict(),
  z.object({
    platform: z.literal("android"),
    device: z.enum(SCREEN_DEVICES_BY_PLATFORM.android),
    ...screenSetPolicyBase,
  }).strict(),
  z.object({
    platform: z.literal("windows"),
    device: z.enum(SCREEN_DEVICES_BY_PLATFORM.windows),
    ...screenSetPolicyBase,
  }).strict(),
  z.object({
    platform: z.literal("web"),
    device: z.enum(SCREEN_DEVICES_BY_PLATFORM.web),
    ...screenSetPolicyBase,
  }).strict(),
]);
export type ScreenSetPolicy = z.infer<typeof ScreenSetPolicy>;

/** One independently editable design composition. Array order is the persisted display order. */
export const DesignLayout = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    mode: CanvasMode,
    /** Missing in older v1 documents means `independent`. */
    screenSetPolicies: z.array(ScreenSetPolicy).optional(),
    screens: z.array(Screen).min(1),
  })
  .strict();
export type DesignLayout = z.infer<typeof DesignLayout>;

const ProjectObject = z
  .object({
    meta: z
      .object({
        name: z.string().min(1),
        appIcon: ProjectRelativePath.optional(),
        schemaVersion: z.literal(SCHEMA_VERSION),
      })
      .strict(),
    fonts: z.array(FontAsset).default([]),
    preferredExportLayoutId: z.string().min(1),
    layouts: z.array(DesignLayout).min(1),
  })
  .strict();

type ProjectShape = z.infer<typeof ProjectObject>;
type LayoutShape = ProjectShape["layouts"][number];

function validateVariants(layout: LayoutShape, layoutIndex: number, ctx: z.RefinementCtx): void {
  const screenIds = new Set<string>();
  layout.screens.forEach((screen, index) => {
    if (screenIds.has(screen.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate screen id: "${screen.id}"`,
        path: ["layouts", layoutIndex, "screens", index, "id"],
      });
    } else {
      screenIds.add(screen.id);
    }
  });

  const screensById = new Map(layout.screens.map((screen) => [screen.id, screen] as const));
  const variantKeys = new Set<string>();
  layout.screens.forEach((screen, index) => {
    const hasVariantRoot = screen.variantOf !== undefined;
    const hasStoreTarget = screen.storeTargetId !== undefined;
    if (hasVariantRoot && !hasStoreTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "variantOf requires storeTargetId",
        path: ["layouts", layoutIndex, "screens", index],
      });
      return;
    }
    // Independent exact-target sets may contain standalone screens. They intentionally have a
    // storeTargetId without a primary-size partner. Synchronized policies reject that state below.
    if (!hasVariantRoot || !screen.variantOf || !screen.storeTargetId) return;

    const root = screensById.get(screen.variantOf);
    if (!root) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `variant root "${screen.variantOf}" does not exist`,
        path: ["layouts", layoutIndex, "screens", index, "variantOf"],
      });
      return;
    }
    if (root.variantOf !== undefined || root.storeTargetId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `variant root "${screen.variantOf}" must be a root screen`,
        path: ["layouts", layoutIndex, "screens", index, "variantOf"],
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
        path: ["layouts", layoutIndex, "screens", index],
      });
    }

    const key = `${screen.variantOf}\u0000${screen.storeTargetId}`;
    if (variantKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate store target variant "${screen.storeTargetId}" for root "${screen.variantOf}"`,
        path: ["layouts", layoutIndex, "screens", index, "storeTargetId"],
      });
    } else {
      variantKeys.add(key);
    }
  });
}

function validateLocaleDirections(layout: LayoutShape, layoutIndex: number, ctx: z.RefinementCtx): void {
  const directionByLocale = new Map<string, LayoutDirection>();
  layout.screens.forEach((screen, index) => {
    const direction = directionByLocale.get(screen.locale);
    if (direction !== undefined && direction !== screen.direction) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `all screens in locale "${screen.locale}" must use direction "${direction}"`,
        path: ["layouts", layoutIndex, "screens", index, "direction"],
      });
    } else {
      directionByLocale.set(screen.locale, screen.direction);
    }
  });
}

function validateScreenSetPolicies(
  layout: LayoutShape,
  layoutIndex: number,
  ctx: z.RefinementCtx,
): void {
  const keys = new Set<string>();
  for (const [policyIndex, policy] of (layout.screenSetPolicies ?? []).entries()) {
    const key = `${policy.platform}\u0000${policy.device}\u0000${policy.locale}`;
    if (keys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate screen set policy for ${policy.platform}/${policy.device}/${policy.locale}`,
        path: ["layouts", layoutIndex, "screenSetPolicies", policyIndex],
      });
      continue;
    }
    keys.add(key);

    const roots = layout.screens.filter((screen) =>
      screen.storeTargetId === undefined
      && screen.platform === policy.platform
      && screen.device === policy.device
      && screen.locale === policy.locale
    );
    if (roots.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `screen set policy has no matching output family`,
        path: ["layouts", layoutIndex, "screenSetPolicies", policyIndex],
      });
      continue;
    }
    if (policy.mode !== "synchronized") continue;

    const rootIds = roots.map((screen) => screen.id);
    const targetIds = Array.from(new Set(layout.screens
      .filter((screen) =>
        screen.platform === policy.platform
        && screen.device === policy.device
        && screen.locale === policy.locale
        && screen.storeTargetId !== undefined
      )
      .map((screen) => screen.storeTargetId!)));
    for (const targetId of targetIds) {
      const variants = layout.screens.filter((screen) =>
        screen.platform === policy.platform
        && screen.device === policy.device
        && screen.locale === policy.locale
        && screen.storeTargetId === targetId
      );
      const variantRootIds = variants.map((screen) => screen.variantOf);
      if (
        variantRootIds.length !== rootIds.length
        || variantRootIds.some((rootId, index) => rootId !== rootIds[index])
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `synchronized screen set target "${targetId}" must match the root screen count and order`,
          path: ["layouts", layoutIndex, "screenSetPolicies", policyIndex, "mode"],
        });
      }
    }
  }
}

function validateElementIds(layout: LayoutShape, layoutIndex: number, ctx: z.RefinementCtx): void {
  layout.screens.forEach((screen, screenIndex) => {
    const ids = new Set<string>();
    const register = (id: string, path: (string | number)[]) => {
      if (ids.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate element id within screen: "${id}"`,
          path: ["layouts", layoutIndex, "screens", screenIndex, ...path, "id"],
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
}

function validateFontIdentities(proj: ProjectShape, ctx: z.RefinementCtx): void {
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
}

function validateLayouts(proj: ProjectShape, ctx: z.RefinementCtx): void {
  const layoutIds = new Set<string>();
  const layoutNames = new Set<string>();
  proj.layouts.forEach((layout, layoutIndex) => {
    if (layoutIds.has(layout.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate layout id: "${layout.id}"`,
        path: ["layouts", layoutIndex, "id"],
      });
    } else {
      layoutIds.add(layout.id);
    }

    const trimmedName = layout.name.trim();
    if (trimmedName !== layout.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "layout name must not have leading or trailing whitespace",
        path: ["layouts", layoutIndex, "name"],
      });
    }
    const normalizedName = trimmedName.toLocaleLowerCase();
    if (layoutNames.has(normalizedName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate layout name: "${layout.name}"`,
        path: ["layouts", layoutIndex, "name"],
      });
    } else {
      layoutNames.add(normalizedName);
    }

    validateVariants(layout, layoutIndex, ctx);
    validateScreenSetPolicies(layout, layoutIndex, ctx);
    validateLocaleDirections(layout, layoutIndex, ctx);
    validateElementIds(layout, layoutIndex, ctx);
  });

  if (!layoutIds.has(proj.preferredExportLayoutId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `preferred export layout "${proj.preferredExportLayoutId}" does not exist`,
      path: ["preferredExportLayoutId"],
    });
  }
}

/** Strict v1 project contract with layout-local and project-global identities validated. */
export const Project = ProjectObject.superRefine((proj, ctx) => {
  validateLayouts(proj, ctx);
  validateFontIdentities(proj, ctx);
});
export type Project = z.infer<typeof Project>;
