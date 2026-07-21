// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import {
  Background,
  Element,
  Screen as ScreenSchema,
  SCREEN_DEVICES_BY_PLATFORM,
  addScreenToProject,
  cloneElementWithFreshIds,
  elementLeaves,
  ensureStoreTargetVariant,
  fitElementsToArtboard,
  setScreenDirection,
  type Project as ProjectModel,
  type Screen,
} from "../model/index.js";
import { fontIdentityKey } from "../model/font-identity.js";
import type { FontIdentity } from "../model/font-identity.js";
import { DEFAULT_TEXT_FONT, isBuiltInFontIdentity } from "../model/built-in-fonts.js";
import { getLayout, replaceLayout } from "../model/project-layout.js";
import { exportPixelRatio } from "../export/pixel-ratio.js";
import { findStoreTarget, type StoreSpecs } from "../export/specs.js";

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
  frame?: "iphone" | "android-phone" | "tablet" | "browser";
  promotion?: boolean;
};

const BUILT_IN_DEFINITIONS: readonly BuiltInDefinition[] = [
  { id: "iphone-starter", name: "iPhone", description: "Bold headline and an editable iPhone mockup.", platform: "apple", device: "iphone", targetId: "6.9", frame: "iphone" },
  { id: "ipad-portrait-starter", name: "iPad portrait", description: "Spacious portrait composition for tablet storytelling.", platform: "apple", device: "ipad", targetId: "13", frame: "tablet" },
  { id: "ipad-landscape-starter", name: "iPad landscape", description: "Landscape tablet composition with safe edge spacing.", platform: "apple", device: "ipad", targetId: "13-landscape", frame: "tablet" },
  { id: "android-phone-starter", name: "Android phone", description: "Google Play phone starter with an empty assignable mockup.", platform: "android", device: "phone", targetId: "phone-portrait", frame: "android-phone" },
  { id: "android-tablet-portrait-starter", name: "Android tablet portrait", description: "7-inch tablet portrait starter.", platform: "android", device: "tablet-7", targetId: "tablet-7-portrait", frame: "tablet" },
  { id: "android-tablet-landscape-starter", name: "Android tablet landscape", description: "10-inch tablet landscape starter.", platform: "android", device: "tablet-10", targetId: "tablet-10-landscape", frame: "tablet" },
  { id: "web-desktop-starter", name: "Web desktop", description: "Responsive desktop review composition with a browser frame.", platform: "web", device: "desktop", targetId: "desktop-1920", frame: "browser" },
  { id: "web-mobile-starter", name: "Web mobile", description: "Responsive mobile composition with an editable browser mockup.", platform: "web", device: "mobile", targetId: "mobile-portrait", frame: "browser" },
  { id: "play-feature-graphic", name: "Play Feature Graphic", description: "Opaque promotion art with named safe and focal guides; no device frame.", platform: "android", device: "phone", targetId: "play-feature-graphic", promotion: true },
  { id: "web-share-cover", name: "Web Share cover", description: "Responsive campaign and review cover starter for the Web Share profile.", platform: "web", device: "desktop", targetId: "desktop-1920", frame: "browser" },
];

export interface BuiltInProjectStarterMetadata {
  id: BuiltInProjectStarterId;
  name: string;
  description: string;
  platform: ScreenTemplate["platform"];
}

/** Creation-dialog subset of the global catalog; landscape starters stay available in Resources. */
export function listBuiltInProjectStarterMetadata(): BuiltInProjectStarterMetadata[] {
  return BUILT_IN_PROJECT_STARTER_IDS.map((id) => {
    const definition = BUILT_IN_DEFINITIONS.find((candidate) => candidate.id === id)!;
    return { id, name: definition.name, description: definition.description, platform: definition.platform };
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
      id: "headline", type: "text", name: "Editable headline", x: safe,
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
    elements.push({
      id: "mockup", type: "device-frame", name: "Drop screenshot here",
      x: width > height ? Math.round(width * 0.54) : Math.round((width - frameWidth) / 2),
      y: Math.round(height * (width > height ? 0.18 : 0.39)), width: frameWidth,
      height: Math.round(frameWidth / (definition.frame === "tablet" ? 0.75 : definition.frame === "browser" ? 1.6 : definition.frame === "android-phone" ? 0.48 : 6 / 13)),
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
    const added = template.platform === "apple"
      ? addScreenToProject(sourceProject, layoutId, { ...common, platform: "apple", device: template.device })
      : template.platform === "android"
        ? addScreenToProject(sourceProject, layoutId, { ...common, platform: "android", device: template.device })
        : template.platform === "windows"
          ? addScreenToProject(sourceProject, layoutId, { ...common, platform: "windows", device: template.device })
          : addScreenToProject(sourceProject, layoutId, { ...common, platform: "web", device: template.device });
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
  const lead = specs[template.platform]?.[template.device]?.[0];
  if (!lead) throw new Error(`No lead store size is configured for ${template.platform}/${template.device}`);
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
