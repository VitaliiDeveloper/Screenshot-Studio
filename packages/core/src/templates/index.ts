// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import {
  Background,
  Element,
  Screen as ScreenSchema,
  SCREEN_DEVICES_BY_PLATFORM,
  addScreenToProject,
  cloneElementWithFreshIds,
  deviceFramePreset,
  elementLeaves,
  ensureStoreTargetVariant,
  fontIdentityKey,
  fitElementsToArtboard,
  getLayout,
  isBuiltInFontIdentity,
  replaceLayout,
  setScreenDirection,
  DEFAULT_TEXT_FONT,
  type CreateScreenInput,
  type DeviceFrameId,
  type FontIdentity,
  type Project as ProjectModel,
  type Screen,
} from "@screenshot-studio/core/model";
import {
  exportPixelRatio,
  findStoreTarget,
  leadStoreSizeId,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { findBuiltInDesignPack, type DesignPack } from "@screenshot-studio/core/themes";
import {
  PANORAMA_SPANS,
  SHOWCASE_SLOTS,
  STYLE_COMPOSITIONS,
  STYLE_PACK_SCREENS,
  spanPanorama,
  styledScreenElements,
  type PanoramaSpan,
  type StyleComposition,
} from "./style-packs.js";

const templateBase = {
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase slug"),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  /** Optional export target materialized as an exact project-local screen. */
  targetId: z.string().min(1).optional(),
  artboard: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  background: Background,
  elements: z.array(Element),
};

export const ScreenTemplate = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("apple"), device: z.enum(SCREEN_DEVICES_BY_PLATFORM.apple), ...templateBase }).strict(),
  z.object({ platform: z.literal("android"), device: z.enum(SCREEN_DEVICES_BY_PLATFORM.android), ...templateBase }).strict(),
  z.object({ platform: z.literal("windows"), device: z.enum(SCREEN_DEVICES_BY_PLATFORM.windows), ...templateBase }).strict(),
  z.object({ platform: z.literal("web"), device: z.enum(SCREEN_DEVICES_BY_PLATFORM.web), ...templateBase }).strict(),
]);
export type ScreenTemplate = z.infer<typeof ScreenTemplate>;

export const BUILT_IN_TEMPLATE_IDS = [
  "iphone-starter",
  "ipad-portrait-starter",
  "ipad-landscape-starter",
  "android-phone-starter",
  "android-tablet-portrait-starter",
  "android-tablet-landscape-starter",
  "web-desktop-starter",
  "web-mobile-starter",
  "play-feature-graphic",
  "web-share-cover",
  "macos-starter",
  "tvos-starter",
  "visionos-starter",
  "wear-os-starter",
] as const;

export const BUILT_IN_PROJECT_STARTER_IDS = [
  "iphone-starter",
  "ipad-portrait-starter",
  "android-phone-starter",
  "android-tablet-portrait-starter",
  "play-feature-graphic",
  "web-desktop-starter",
  "web-mobile-starter",
] as const;
export type BuiltInProjectStarterId = (typeof BUILT_IN_PROJECT_STARTER_IDS)[number];

type BuiltInDefinition = {
  id: (typeof BUILT_IN_TEMPLATE_IDS)[number];
  name: string;
  description: string;
  platform: ScreenTemplate["platform"];
  device: ScreenTemplate["device"];
  targetId: string;
  frame?: DeviceFrameId;
  promotion?: boolean;
  appScreenshotOnly?: boolean;
};

const BUILT_IN_DEFINITIONS: readonly BuiltInDefinition[] = [
  { id: "iphone-starter", name: "iPhone", description: "Bold headline and an editable iPhone mockup.", platform: "apple", device: "iphone", targetId: "6.3", frame: "iphone" },
  { id: "ipad-portrait-starter", name: "iPad portrait", description: "Spacious portrait composition for tablet storytelling.", platform: "apple", device: "ipad", targetId: "13", frame: "tablet" },
  { id: "ipad-landscape-starter", name: "iPad landscape", description: "Landscape tablet composition with safe edge spacing.", platform: "apple", device: "ipad", targetId: "13-landscape", frame: "tablet" },
  { id: "android-phone-starter", name: "Android phone", description: "Google Play phone starter with an empty assignable mockup.", platform: "android", device: "phone", targetId: "phone-portrait", frame: "android-phone" },
  { id: "android-tablet-portrait-starter", name: "Android tablet portrait", description: "9:16 tablet portrait starter.", platform: "android", device: "tablet-7", targetId: "tablet-portrait", frame: "tablet" },
  { id: "android-tablet-landscape-starter", name: "Android tablet landscape", description: "16:9 tablet landscape starter.", platform: "android", device: "tablet-7", targetId: "tablet-landscape", frame: "tablet" },
  { id: "web-desktop-starter", name: "Web desktop", description: "Responsive desktop review composition with a browser frame.", platform: "web", device: "desktop", targetId: "desktop-1920", frame: "browser" },
  { id: "web-mobile-starter", name: "Web mobile", description: "Responsive mobile composition with an editable browser mockup.", platform: "web", device: "mobile", targetId: "mobile-portrait", frame: "browser" },
  { id: "play-feature-graphic", name: "Play Feature Graphic", description: "Opaque promotion art with named safe and focal guides; no device frame.", platform: "android", device: "phone", targetId: "play-feature-graphic", promotion: true },
  { id: "web-share-cover", name: "Web Share cover", description: "Responsive campaign and review cover starter for the Web Share profile.", platform: "web", device: "desktop", targetId: "desktop-1920", frame: "browser" },
  { id: "macos-starter", name: "macOS", description: "Computer composition with one editable laptop mockup.", platform: "apple", device: "macos", targetId: "2880x1800", frame: "laptop-silver" },
  { id: "tvos-starter", name: "tvOS", description: "Large-screen composition with one editable TV mockup.", platform: "apple", device: "tvos", targetId: "4k", frame: "tv" },
  { id: "visionos-starter", name: "Apple Vision Pro", description: "Spatial composition with one editable XR viewport.", platform: "apple", device: "visionos", targetId: "vision-pro", frame: "xr-viewport" },
  { id: "wear-os-starter", name: "Wear OS Store screenshot", description: "Frameless app UI sized for a compliant Wear OS Store screenshot.", platform: "android", device: "wear", targetId: "wear-square", appScreenshotOnly: true },
];

export interface BuiltInProjectStarterMetadata {
  id: BuiltInProjectStarterId;
  name: string;
  description: string;
  platform: ScreenTemplate["platform"];
  device: ScreenTemplate["device"];
}

/** Creation-dialog subset of the global catalog; landscape starters stay available in Resources. */
export function listBuiltInProjectStarterMetadata(): BuiltInProjectStarterMetadata[] {
  return BUILT_IN_PROJECT_STARTER_IDS.map((id) => {
    const definition = BUILT_IN_DEFINITIONS.find((candidate) => candidate.id === id)!;
    return {
      id,
      name: definition.name,
      description: definition.description,
      platform: definition.platform,
      device: definition.device,
    };
  });
}

type ResolvedBuiltInDefinition = BuiltInDefinition & { width: number; height: number };

function resolveBuiltInDefinition(definition: BuiltInDefinition, specs: StoreSpecs): ResolvedBuiltInDefinition {
  const target = findStoreTarget(specs, definition.platform, definition.device, definition.targetId);
  return {
    ...definition,
    width: target.width,
    height: target.height,
  };
}

function builtInElements(definition: ResolvedBuiltInDefinition, font?: FontIdentity): ScreenTemplate["elements"] {
  const { width, height } = definition;
  if (definition.appScreenshotOnly) {
    return [{
      id: "app-screenshot",
      type: "screenshot",
      name: "Replace with app screenshot",
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      assetUrl: "assets/replace-with-wear-app-screenshot.png",
      fit: "cover",
      cornerRadius: 0,
    }];
  }
  const safe = Math.round(Math.min(width, height) * 0.08);
  const elements: ScreenTemplate["elements"] = [
    {
      id: "accent", type: "shape", name: "Accent panel", x: safe, y: safe,
      width: Math.round(width * 0.32), height: Math.round(height * 0.035), rotation: 0,
      opacity: 1, locked: false, visible: true, kind: "rect", fill: "#38BDF8",
      radius: Math.round(Math.min(width, height) * 0.018), role: "accent",
    },
  ];
  if (font) {
    elements.push({
      id: "headline", type: "text", x: safe,
      y: Math.round(height * 0.14), width: Math.round(width * (definition.promotion ? 0.58 : 0.78)),
      height: Math.round(height * 0.2), rotation: 0, opacity: 1, locked: false, visible: true,
      content: definition.promotion ? "Make every moment stand out" : "Show what makes your app different",
      fontFamily: font.family, size: Math.max(28, Math.round(Math.min(width, height) * 0.075)),
      weight: font.weight, lineHeight: 1.05, letterSpacing: -1, align: "left", color: "#FFFFFF",
      role: "heading",
    });
  }
  if (definition.promotion) {
    elements.push(
      { id: "safe-zone", type: "shape", name: "Safe zone guide", x: safe, y: safe, width: width - safe * 2, height: height - safe * 2, rotation: 0, opacity: 0.18, locked: true, visible: true, kind: "rect", fill: "#FFFFFF", radius: 20, stroke: { color: "#FFFFFF", width: 3 } },
      { id: "focal-zone", type: "shape", name: "Focal zone guide", x: Math.round(width * 0.62), y: Math.round(height * 0.2), width: Math.round(width * 0.25), height: Math.round(height * 0.6), rotation: 0, opacity: 0.35, locked: true, visible: true, kind: "ellipse", fill: "#FDE047", radius: 0 },
    );
  } else if (definition.frame) {
    const frameWidth = Math.round(width * (width > height ? 0.42 : 0.6));
    const frameAspectRatio = deviceFramePreset(definition.frame).recipe.spec.aspectRatio;
    elements.push({
      id: "mockup", type: "device-frame", name: "Drop screenshot here",
      x: width > height ? Math.round(width * 0.54) : Math.round((width - frameWidth) / 2),
      y: Math.round(height * (width > height ? 0.18 : 0.39)), width: frameWidth,
      height: Math.round(frameWidth / frameAspectRatio),
      rotation: 0, opacity: 1, locked: false, visible: true, deviceType: definition.frame, fit: "cover",
    });
  }
  return elements;
}

/** Process-global read-only starters. Returned literals are safe to materialize as ordinary screens. */
export function listBuiltInTemplates(specs: StoreSpecs, font: FontIdentity = DEFAULT_TEXT_FONT): ScreenTemplate[] {
  return BUILT_IN_DEFINITIONS.map((entry) => {
    const definition = resolveBuiltInDefinition(entry, specs);
    return ScreenTemplate.parse({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      targetId: definition.targetId,
      platform: definition.platform,
      device: definition.device,
      artboard: { width: definition.width, height: definition.height },
      background: { type: "linear-gradient", from: "#0F172A", to: "#1D4ED8", angle: 135 },
      elements: builtInElements(definition, font),
    });
  });
}

export function findBuiltInTemplate(id: string, specs: StoreSpecs, font?: FontIdentity): ScreenTemplate | undefined {
  return listBuiltInTemplates(specs, font).find((template) => template.id === id);
}

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "expected a lowercase slug");

/** Multi-screen set, built in or read from a project `packs/<id>/screen-pack.json`; each screen materializes as an ordinary Screen. */
export const TemplatePack = z.object({
  id: slug,
  name: z.string().min(1),
  description: z.string().min(1),
  platform: z.string().min(1),
  device: z.string().min(1),
  /** Style tag for catalog filtering; matches the built-in Design pack the screens were baked from. */
  style: slug,
  /** Art spans screen edges, which only a connected layout renders. */
  panorama: z.literal(true).optional(),
  screens: z.array(ScreenTemplate).min(1),
}).strict().superRefine((pack, context) => {
  pack.screens.forEach((screen, index) => {
    if (screen.platform !== pack.platform || screen.device !== pack.device) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["screens", index],
        message: `expected ${pack.platform}/${pack.device} screen`,
      });
    }
  });
});
export type TemplatePack = z.infer<typeof TemplatePack>;

type BuiltInTemplatePackScreen = { id: string; name: string; headline: string; subline: string; card?: boolean };

type BuiltInTemplatePackDefinition = {
  id: string;
  name: string;
  description: string;
  platform: ScreenTemplate["platform"];
  device: ScreenTemplate["device"];
  targetId: string;
  frame: DeviceFrameId;
  style: string;
  screens: readonly BuiltInTemplatePackScreen[];
  composition?: StyleComposition;
  span?: PanoramaSpan;
};

const STYLE_PACK_TARGETS = [
  { slug: "iphone", label: "iPhone", platform: "apple", device: "iphone", targetId: "6.3" },
  { slug: "android-phone", label: "Android phone", platform: "android", device: "phone", targetId: "phone-portrait" },
] as const;

const STYLE_PACK_FRAMES: Readonly<Record<string, Record<(typeof STYLE_PACK_TARGETS)[number]["slug"], DeviceFrameId>>> = {
  clean: { iphone: "iphone", "android-phone": "android-phone" },
  aurora: { iphone: "iphone", "android-phone": "phone-punch-hole-dark" },
  midnight: { iphone: "phone-modern-light", "android-phone": "android-phone" },
  poster: { iphone: "phone-modern-dark", "android-phone": "android-phone" },
  sunrise: { iphone: "iphone", "android-phone": "phone-punch-hole-dark" },
};

const SHOWCASE_STYLES = ["midnight", "poster"];

const STYLE_VARIANTS: { style: string; composition: StyleComposition; span?: PanoramaSpan }[] = [
  ...Object.entries(STYLE_COMPOSITIONS).map(([style, composition]) => ({ style, composition })),
  ...Object.entries(PANORAMA_SPANS).map(([style, span]) => ({
    style,
    span,
    // Copy stays on top so the shared art below it can line up on every screen.
    composition: { ...STYLE_COMPOSITIONS[style]!, textAt: () => "top" as const, decor: () => [] },
  })),
  // Bold, centred-glow and poster type carry tilted devices best; the soft styles stay calm.
  ...SHOWCASE_STYLES.map((style) => ({ style, composition: { ...STYLE_COMPOSITIONS[style]!, slots: SHOWCASE_SLOTS } })),
];

type StylePackTarget = { slug: string; label: string; platform: ScreenTemplate["platform"]; device: ScreenTemplate["device"]; targetId: string };

/**
 * Clean everywhere, plus Aurora on tablets. Mac draws no style art beside its copy column, so it pairs
 * Clean with Poster, the other style that is all palette and type. Panoramas stay phone-only.
 */
const LARGE_SCREEN_STYLE_PACK_TARGETS: readonly (StylePackTarget & { frames: Readonly<Record<string, DeviceFrameId>>; bleed?: number })[] = [
  // 3:4 leaves too little height under the copy, so the device runs off the bottom edge.
  { slug: "ipad", label: "iPad", platform: "apple", device: "ipad", targetId: "13", frames: { clean: "tablet", aurora: "tablet-rounded-dark" }, bleed: 0.12 },
  { slug: "android-tablet", label: "Android tablet", platform: "android", device: "tablet-7", targetId: "tablet-portrait", frames: { clean: "tablet-rounded-dark", aurora: "tablet" } },
  { slug: "macos", label: "macOS", platform: "apple", device: "macos", targetId: "2880x1800", frames: { clean: "laptop-dark", poster: "laptop-silver" } },
];

function styleTemplatePackDefinition(
  style: string,
  composition: StyleComposition,
  span: PanoramaSpan | undefined,
  target: StylePackTarget,
  frame: DeviceFrameId,
): BuiltInTemplatePackDefinition {
  const pack = findBuiltInDesignPack(style)!;
  const variant = span ? "panorama" : composition.slots ? "showcase" : null;
  const id = variant ? `${style}-${variant}-${target.slug}` : `${style}-${target.slug}`;
  return {
    id,
    name: `${pack.name}${variant ? ` ${variant}` : ""} · ${target.label}`,
    description: span
      ? `${STYLE_PACK_SCREENS.length} connected ${target.label} screens: ${span.summary}.`
      : composition.slots
        ? `${STYLE_PACK_SCREENS.length} ${target.label} screens with tilted and paired devices and a big-number proof: ${pack.description}`
        : `${STYLE_PACK_SCREENS.length} ${target.label} screens: ${pack.description}`,
    platform: target.platform,
    device: target.device,
    targetId: target.targetId,
    frame,
    style,
    screens: STYLE_PACK_SCREENS.map((screen) => ({ id: `${id}-${screen.key}`, name: screen.name, headline: screen.headline, subline: screen.subline })),
    composition,
    span,
  };
}

const STYLE_TEMPLATE_PACK_DEFINITIONS: BuiltInTemplatePackDefinition[] = [
  ...STYLE_VARIANTS.flatMap(({ style, composition, span }) => STYLE_PACK_TARGETS.map((target) => (
    styleTemplatePackDefinition(style, composition, span, target, STYLE_PACK_FRAMES[style]![target.slug])
  ))),
  ...LARGE_SCREEN_STYLE_PACK_TARGETS.flatMap((target) => Object.entries(target.frames).map(([style, frame]) => {
    const composition = STYLE_COMPOSITIONS[style]!;
    const bleed = Math.max(composition.bleed, target.bleed ?? 0);
    return styleTemplatePackDefinition(style, { ...composition, bleed }, undefined, target, frame);
  })),
];

// The neutral seed predates the styled packs; CLI, API, and editor tests address it by id.
const BUILT_IN_TEMPLATE_PACK_DEFINITIONS: readonly BuiltInTemplatePackDefinition[] = [{
  id: "neutral-iphone-basics",
  name: "Neutral basics · iPhone",
  description: "Two light iPhone screens with a headline, a subline, and an editable mockup.",
  platform: "apple",
  device: "iphone",
  targetId: "6.3",
  frame: "iphone",
  style: "neutral-default",
  screens: [
    { id: "neutral-iphone-hero", name: "Hero", headline: "Your app, at a glance", subline: "Say what it does in one short line." },
    { id: "neutral-iphone-feature", name: "Feature", headline: "One idea per screen", subline: "Explain a single feature with a short supporting line.", card: true },
  ],
}, ...STYLE_TEMPLATE_PACK_DEFINITIONS];

export interface BuiltInTemplatePackMetadata {
  id: string;
  name: string;
  description: string;
  platform: ScreenTemplate["platform"];
  device: ScreenTemplate["device"];
  style: string;
  panorama: boolean;
  screenCount: number;
}

export function listBuiltInTemplatePackMetadata(): BuiltInTemplatePackMetadata[] {
  return BUILT_IN_TEMPLATE_PACK_DEFINITIONS.map((definition) => ({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    platform: definition.platform,
    device: definition.device,
    style: definition.style,
    panorama: definition.span !== undefined,
    screenCount: definition.screens.length,
  }));
}

function templatePackElements(
  definition: BuiltInTemplatePackDefinition,
  screen: BuiltInTemplatePackScreen,
  style: DesignPack,
  width: number,
  height: number,
): ScreenTemplate["elements"] {
  const shortSide = Math.min(width, height);
  const safe = Math.round(shortSide * 0.08);
  const text = (role: "heading" | "body", id: string, content: string, y: number, boxHeight: number) => {
    const typography = style.typography[role];
    const size = Math.round(shortSide * typography.sizeRatio);
    return {
      id, type: "text" as const, role, x: safe, y, width: width - safe * 2, height: boxHeight,
      rotation: 0, opacity: 1, locked: false, visible: true, content,
      fontFamily: typography.family, weight: typography.weight, size,
      lineHeight: typography.lineHeight, letterSpacing: Math.round(size * typography.letterSpacingEm * 100) / 100,
      align: "left" as const, color: style.palette[role],
    };
  };
  const frameWidth = Math.round(width * 0.6);
  const frameHeight = Math.round(frameWidth / deviceFramePreset(definition.frame).recipe.spec.aspectRatio);
  const elements: ScreenTemplate["elements"] = [
    {
      id: "accent", type: "shape", role: "accent", name: "Accent bar", x: safe, y: safe,
      width: Math.round(width * 0.18), height: Math.round(shortSide * 0.016), rotation: 0,
      opacity: 1, locked: false, visible: true, kind: "rect", fill: style.palette.accent,
      radius: Math.round(shortSide * 0.008),
    },
    text("heading", "headline", screen.headline, Math.round(height * 0.12), Math.round(height * 0.14)),
  ];
  if (screen.card) {
    elements.push({
      id: "card", type: "shape", role: "surface", name: "Subline card", x: Math.round(safe / 2),
      y: Math.round(height * 0.26), width: width - safe, height: Math.round(height * 0.1), rotation: 0,
      opacity: 1, locked: false, visible: true, kind: "rect", fill: style.palette.surface,
      radius: Math.round(shortSide * 0.03),
    });
  }
  elements.push(
    text("body", "subline", screen.subline, Math.round(height * 0.27), Math.round(height * 0.08)),
    {
      id: "mockup", type: "device-frame", name: "Drop screenshot here",
      x: Math.round((width - frameWidth) / 2), y: Math.round(height * 0.39),
      width: frameWidth, height: frameHeight, rotation: 0, opacity: 1, locked: false, visible: true,
      deviceType: definition.frame, fit: "cover",
    },
  );
  return elements;
}

/** Process-global read-only screen packs, resolved against store specs for exact artboards. */
export function listBuiltInTemplatePacks(specs: StoreSpecs): TemplatePack[] {
  return BUILT_IN_TEMPLATE_PACK_DEFINITIONS.map((definition) => {
    const style = findBuiltInDesignPack(definition.style);
    if (!style) throw new Error(`Template pack "${definition.id}" references unknown design pack "${definition.style}"`);
    const target = findStoreTarget(specs, definition.platform, definition.device, definition.targetId);
    const screenElements = definition.screens.map((screen, index) => definition.composition
      ? styledScreenElements(definition.composition, STYLE_PACK_SCREENS[index]!, index, definition.frame, style, target.width, target.height)
      : templatePackElements(definition, screen, style, target.width, target.height));
    const elements = definition.span
      ? spanPanorama(definition.span, screenElements, style, target.width, target.height)
      : screenElements;
    return TemplatePack.parse({
      id: definition.id,
      name: definition.name,
      description: definition.description,
      platform: definition.platform,
      device: definition.device,
      style: definition.style,
      ...(definition.span ? { panorama: true } : {}),
      screens: definition.screens.map((screen, index) => ({
        id: screen.id,
        name: screen.name,
        targetId: definition.targetId,
        platform: definition.platform,
        device: definition.device,
        artboard: { width: target.width, height: target.height },
        background: style.background,
        elements: elements[index],
      })),
    });
  });
}

export function findBuiltInTemplatePack(id: string, specs: StoreSpecs): TemplatePack | undefined {
  return listBuiltInTemplatePacks(specs).find((pack) => pack.id === id);
}

export function parseTemplateJson(json: string): ScreenTemplate {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new Error(`Template file is not valid JSON: ${(error as Error).message}`, { cause: error });
  }
  const result = ScreenTemplate.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid template JSON:\n${issues}`);
  }
  return result.data;
}

function assertTemplateFontsRegistered(project: ProjectModel, template: ScreenTemplate): void {
  const registered = new Set(project.fonts.map(fontIdentityKey));
  const missing = new Set<string>();
  for (const element of template.elements) {
    for (const leaf of elementLeaves(element)) {
      if (leaf.type !== "text") continue;
      const key = fontIdentityKey({ family: leaf.fontFamily, weight: leaf.weight });
      if (!registered.has(key)
        && !isBuiltInFontIdentity({ family: leaf.fontFamily, weight: leaf.weight })) {
        missing.add(`"${leaf.fontFamily}" ${leaf.weight}`);
      }
    }
  }
  if (missing.size > 0) {
    throw new Error(
      `Template "${template.id}" requires unregistered font identities: ${Array.from(missing).join(", ")}`,
    );
  }
}

export function createScreenFromTemplate(
  project: ProjectModel,
  layoutId: string,
  input: ScreenTemplate,
  locale: string,
  specs?: StoreSpecs,
  options: { exactTargetMode?: "paired" | "standalone" } = {},
): { project: ProjectModel; screen: Screen } {
  const template = ScreenTemplate.parse(input);
  if (!locale.trim()) throw new Error("Template screen locale must not be empty");
  assertTemplateFontsRegistered(project, template);
  const append = (
    sourceProject: ProjectModel,
    artboard: { width: number; height: number },
    elements: ScreenTemplate["elements"],
    storeTargetId?: string,
  ): { project: ProjectModel; screen: Screen } => {
    const common = {
      id: template.id,
      name: template.name,
      locale,
      artboard,
      background: template.background,
      elements: elements.map((element) => cloneElementWithFreshIds(element)),
    };
    const existingIds = new Set(getLayout(sourceProject, layoutId).screens.map((screen) => screen.id));
    const added = addScreenToProject(sourceProject, layoutId, {
      ...common,
      platform: template.platform,
      device: template.device,
    } as CreateScreenInput);
    const layout = getLayout(added, layoutId);
    const created = layout.screens.filter((candidate) => !existingIds.has(candidate.id));
    const screen = created.find((candidate) => (
      candidate.variantOf === undefined && candidate.storeTargetId === undefined
    ));
    if (!screen) throw new Error(`Template "${template.id}" did not create a root screen`);
    const exactScreen = storeTargetId
      ? ScreenSchema.parse({ ...screen, storeTargetId })
      : screen;
    // Template geometry is authored as physical LTR literals. Bake locale direction once.
    const localized = exactScreen.direction === "ltr"
      ? exactScreen
      : setScreenDirection({ ...exactScreen, direction: "ltr" }, exactScreen.direction);
    const replacements = new Map<string, Screen>([[screen.id, localized]]);
    for (const createdScreen of created) {
      if (createdScreen.id === screen.id || createdScreen.direction === "ltr") continue;
      replacements.set(
        createdScreen.id,
        setScreenDirection({ ...createdScreen, direction: "ltr" }, createdScreen.direction),
      );
    }
    if (replacements.size === 1 && localized === screen) return { project: added, screen };
    return {
      project: replaceLayout(added, {
        ...layout,
        screens: layout.screens.map((candidate) => replacements.get(candidate.id) ?? candidate),
      }),
      screen: localized,
    };
  };

  if (!template.targetId) return append(project, template.artboard, template.elements);
  if (!specs) throw new Error(`Template "${template.id}" requires store specs for target "${template.targetId}"`);

  const target = findStoreTarget(specs, template.platform, template.device, template.targetId);
  exportPixelRatio(template.artboard, target);
  if (options.exactTargetMode === "standalone") {
    return append(project, template.artboard, template.elements, target.id);
  }
  const lead = findStoreTarget(
    specs,
    template.platform,
    template.device,
    leadStoreSizeId(specs, template.platform, template.device),
  );
  if (lead.id === target.id) return append(project, template.artboard, template.elements);

  // Root screens remain the family master. A non-lead starter is the exact target variant,
  // preserving export semantics without widening the persisted project schema.
  const leadArtboard = { width: lead.width, height: lead.height };
  const rootResult = append(
    project,
    leadArtboard,
    fitElementsToArtboard(template.elements, template.artboard, leadArtboard),
  );
  const variantResult = ensureStoreTargetVariant(
    rootResult.project,
    layoutId,
    rootResult.screen.id,
    target,
  );
  const layout = getLayout(variantResult.project, layoutId);
  const physicalVariant = ScreenSchema.parse({
    ...variantResult.variant,
    artboard: template.artboard,
    background: template.background,
    elements: template.elements.map((element) => cloneElementWithFreshIds(element)),
  });
  const variant = physicalVariant.direction === "ltr"
    ? physicalVariant
    : setScreenDirection({ ...physicalVariant, direction: "ltr" }, physicalVariant.direction);
  const nextProject = replaceLayout(variantResult.project, {
    ...layout,
    screens: layout.screens.map((screen) => screen.id === variant.id ? variant : screen),
  });
  return { project: nextProject, screen: variant };
}

/** Append every pack screen, in order, as ordinary screens of the layout. */
export function createScreensFromTemplatePack(
  project: ProjectModel,
  layoutId: string,
  input: TemplatePack,
  locale: string,
  specs: StoreSpecs,
): { project: ProjectModel; screens: Screen[] } {
  const pack = TemplatePack.parse(input);
  if (pack.panorama && getLayout(project, layoutId).mode !== "connected") {
    throw new Error(`Template pack "${pack.id}" spans screen edges; switch layout "${layoutId}" to Panorama first`);
  }
  let next = project;
  const screens: Screen[] = [];
  for (const template of pack.screens) {
    const result = createScreenFromTemplate(next, layoutId, template, locale, specs);
    next = result.project;
    screens.push(result.screen);
  }
  return { project: next, screens };
}
