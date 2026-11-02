// SPDX-License-Identifier: Apache-2.0
import {
  deviceFramePreset,
  DEFAULT_TEXT_FONT,
  type DeviceFrameId,
  type FontIdentity,
} from "@screenshot-studio/core/model";
import { findStoreTarget, type StoreSpecs } from "@screenshot-studio/core/export";
import { ScreenTemplate } from "./schemas.js";

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
