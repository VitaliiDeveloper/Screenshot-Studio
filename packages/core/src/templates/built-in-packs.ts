// SPDX-License-Identifier: Apache-2.0
import { deviceFramePreset, type DeviceFrameId } from "@screenshot-studio/core/model";
import { findStoreTarget, type StoreSpecs } from "@screenshot-studio/core/export";
import { findBuiltInDesignPack, type DesignPack } from "@screenshot-studio/core/themes";
import { TemplatePack, type ScreenTemplate } from "./schemas.js";
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
