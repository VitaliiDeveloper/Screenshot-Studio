// SPDX-License-Identifier: Apache-2.0
import {
  Project,
  Screen as ScreenSchema,
  SCREEN_DEVICES_BY_PLATFORM,
  type Element,
  type Background,
  type LayoutDirection,
  type Platform,
  type Project as ProjectModel,
  type Screen,
} from "./schema.js";
import { fontIdentityKey, type FontIdentity } from "./font-identity.js";
import { cloneElementWithFreshIds, elementLeaves, mirrorElement } from "./element-tree.js";

export interface StoreTargetDimensions {
  id: string;
  width: number;
  height: number;
}

/** Slug suitable for screen ids (lowercase, hyphenated, non-empty). */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "screen"
  );
}

/** Title-case words from an id/slug for a default display name. */
export function titleFromId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** First free id derived from `base` among existing screens. */
export function uniqueId(base: string, screens: readonly { id: string }[]): string {
  const used = new Set(screens.map((screen) => screen.id));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Text font identities that have no file-backed project font. Pure: filesystem loading stays in hosts. */
export function findUnresolvedFonts(project: ProjectModel): FontIdentity[] {
  const registered = new Set(project.fonts.map(fontIdentityKey));
  const unresolved: FontIdentity[] = [];
  const seen = new Set<string>();

  for (const screen of project.screens) {
    for (const element of screen.elements) {
      for (const leaf of elementLeaves(element)) {
        if (leaf.type !== "text") continue;
        const key = fontIdentityKey({ family: leaf.fontFamily, weight: leaf.weight });
        if (!registered.has(key) && !seen.has(key)) {
          unresolved.push({ family: leaf.fontFamily, weight: leaf.weight });
          seen.add(key);
        }
      }
    }
  }
  return unresolved;
}

export function formatUnresolvedFontsError(unresolved: readonly FontIdentity[]): string {
  const identities = unresolved.map((font) => `"${font.family}" ${font.weight}`).join(", ");
  return `Cannot export: unresolved project fonts: ${identities}. Register each font in the Fonts dialog or with screenshots font add.`;
}

/** Reject nondeterministic system-font fallbacks before a render host or browser is created. */
export function assertProjectFontsResolved(project: ProjectModel): void {
  const unresolved = findUnresolvedFonts(project);
  if (unresolved.length > 0) throw new Error(formatUnresolvedFontsError(unresolved));
}

/**
 * Re-derive `platforms` and `locales` from screens and re-validate.
 * Call after any mutation that adds/removes screens or changes platform/locale.
 */
export function recomputeManifests(project: ProjectModel): ProjectModel {
  const platforms = Array.from(new Set(project.screens.map((screen) => screen.platform)));
  const locales = Array.from(new Set(project.screens.map((screen) => screen.locale)));
  return Project.parse({ ...project, platforms, locales });
}

/** Platform + device pairs allowed by the schema (no invalid cross products). */
export type ScreenPlacement = {
  [P in Platform]: { platform: P; device: (typeof SCREEN_DEVICES_BY_PLATFORM)[P][number] };
}[Platform];

export function isScreenPlacement(platform: string, device: string): boolean {
  return parseScreenPlacement(platform, device) !== null;
}

export function parseScreenPlacement(platform: string, device: string): ScreenPlacement | null {
  if (!(platform in SCREEN_DEVICES_BY_PLATFORM)) return null;
  const typedPlatform = platform as Platform;
  const devices = SCREEN_DEVICES_BY_PLATFORM[typedPlatform] as readonly string[];
  return devices.includes(device) ? ({ platform: typedPlatform, device } as ScreenPlacement) : null;
}

export type CreateScreenInput = ScreenPlacement & {
  id?: string;
  name?: string;
  locale: string;
  direction?: LayoutDirection;
  artboard: { width: number; height: number };
  elements?: Element[];
  background?: Background;
  /** Convenience for CLI/import callers that only create solid backgrounds. */
  backgroundColor?: string;
};

/** Schema-valid empty (or pre-populated) screen. Pure — no store-specs dependency. */
export function createScreen(input: CreateScreenInput): Screen {
  const base = {
    id: input.id ?? crypto.randomUUID(),
    name: input.name ?? titleFromId(input.id ?? "screen"),
    locale: input.locale,
    direction: input.direction ?? "ltr",
    artboard: input.artboard,
    background: input.background
      ?? { type: "solid" as const, color: input.backgroundColor ?? "#101827" },
    elements: input.elements ?? [],
  };
  if (input.platform === "apple") {
    return { ...base, platform: "apple", device: input.device };
  }
  if (input.platform === "android") {
    return { ...base, platform: "android", device: input.device };
  }
  return { ...base, platform: "windows", device: input.device };
}

export function addScreenToProject(project: ProjectModel, input: CreateScreenInput): ProjectModel {
  const baseId = slugify(
    input.id ?? input.name ?? `${input.platform}-${input.device}-${input.locale}`,
  );
  const id = uniqueId(baseId, project.screens);
  const name = input.name ?? titleFromId(id);
  const localeDirection = project.screens.find((screen) => screen.locale === input.locale)?.direction;
  const screen = createScreen({
    ...input,
    id,
    name,
    direction: input.direction ?? localeDirection ?? "ltr",
  });
  return recomputeManifests({ ...project, screens: [...project.screens, screen] });
}

export function removeScreenFromProject(project: ProjectModel, id: string): ProjectModel {
  const index = project.screens.findIndex((screen) => screen.id === id);
  if (index === -1) throw new Error(`Unknown screen "${id}"`);
  const removed = project.screens[index]!;
  const rootScreens = project.screens.filter((screen) => screen.variantOf === undefined);
  if (removed.variantOf === undefined && rootScreens.length === 1) {
    throw new Error("Cannot remove the last screen (root)");
  }
  const screens = project.screens.filter((screen) =>
    screen.id !== id && screen.variantOf !== id,
  );
  return recomputeManifests({ ...project, screens });
}

/** 1-based position (CLI / human-facing). */
export function reorderScreenInProject(
  project: ProjectModel,
  id: string,
  position: number,
): ProjectModel {
  const from = project.screens.findIndex((screen) => screen.id === id);
  if (from === -1) throw new Error(`Unknown screen "${id}"`);
  if (!Number.isInteger(position) || position < 1 || position > project.screens.length) {
    throw new Error(`Position must be between 1 and ${project.screens.length}`);
  }
  const screens = [...project.screens];
  const [screen] = screens.splice(from, 1);
  screens.splice(position - 1, 0, screen!);
  return Project.parse({ ...project, screens });
}

/** Deep-clone a screen with fresh screen + element ids (editor "duplicate screen"). */
export function cloneScreenWithFreshIds(src: Screen): Screen {
  const copy = structuredClone(src);
  copy.id = crypto.randomUUID();
  copy.name = `${src.name} copy`;
  copy.elements = copy.elements.map((element) => cloneElementWithFreshIds(element));
  return copy;
}

function scaleLeafForArtboard<T extends Exclude<Element, { type: "group" }>>(
  leaf: T,
  scale: number,
  offsetX = 0,
  offsetY = 0,
): T {
  return {
    ...leaf,
    x: leaf.x * scale + offsetX,
    y: leaf.y * scale + offsetY,
    width: leaf.width * scale,
    height: leaf.height * scale,
    ...(leaf.type === "text"
      ? { size: leaf.size * scale, letterSpacing: (leaf.letterSpacing ?? 0) * scale }
      : {}),
    ...(leaf.type === "shape" ? { radius: (leaf.radius ?? 0) * scale } : {}),
    ...(leaf.type === "icon" ? { strokeWidth: (leaf.strokeWidth ?? 2) * scale } : {}),
    ...(leaf.type === "screenshot" || leaf.type === "image"
      ? { cornerRadius: (leaf.cornerRadius ?? 0) * scale }
      : {}),
  } as T;
}

/** Fit a root composition into a target artboard without distorting render-bearing elements. */
export function fitElementsToArtboard(
  elements: readonly Element[],
  source: { width: number; height: number },
  target: { width: number; height: number },
): Element[] {
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const offsetX = (target.width - source.width * scale) / 2;
  const offsetY = (target.height - source.height * scale) / 2;
  return elements.map((element) => {
    if (element.type !== "group") return scaleLeafForArtboard(element, scale, offsetX, offsetY);
    return {
      ...element,
      x: element.x * scale + offsetX,
      y: element.y * scale + offsetY,
      width: element.width * scale,
      height: element.height * scale,
      children: element.children.map((child) => scaleLeafForArtboard(child, scale)),
    };
  });
}

/** Resize one root artboard and fit its composition atomically; exact variants stay independent. */
export function resizeRootArtboard(
  project: ProjectModel,
  screenId: string,
  target: { width: number; height: number },
): ProjectModel {
  const source = project.screens.find((screen) => screen.id === screenId);
  if (!source) throw new Error(`Unknown screen "${screenId}"`);
  if (source.variantOf !== undefined || source.storeTargetId !== undefined) {
    throw new Error("Exact store-target variants have fixed artboards");
  }
  if (source.artboard.width === target.width && source.artboard.height === target.height) {
    return project;
  }

  const resized = ScreenSchema.parse({
    ...source,
    artboard: target,
    elements: fitElementsToArtboard(source.elements, source.artboard, target),
  });
  return {
    ...project,
    screens: project.screens.map((screen) => screen.id === screenId ? resized : screen),
  };
}

/** Resize every root/master in one store output set; size variants remain independent. */
export function resizeStoreOutputArtboards(
  project: ProjectModel,
  sourceScreenId: string,
  target: { width: number; height: number },
): ProjectModel {
  const source = project.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);
  if (source.variantOf !== undefined || source.storeTargetId !== undefined) {
    throw new Error("Exact store-target variants have fixed artboards");
  }

  let next = project;
  for (const screen of project.screens) {
    if (
      screen.variantOf === undefined
      && screen.platform === source.platform
      && screen.device === source.device
      && screen.locale === source.locale
    ) {
      next = resizeRootArtboard(next, screen.id, target);
    }
  }
  return next;
}

export interface StoreTargetVariantResult {
  project: ProjectModel;
  variant: Screen;
  created: boolean;
}

export interface StoreOutputFamilyResult {
  project: ProjectModel;
  firstScreen: Screen;
  created: boolean;
}

/**
 * Create one independent platform/device output set for the source locale. Every root screen in
 * the source family is copied with fresh ids and fitted to the destination lead artboard; size
 * variants remain family-local and are deliberately not copied.
 */
export function ensureStoreOutputFamily(
  project: ProjectModel,
  sourceScreenId: string,
  platform: string,
  device: string,
  leadTarget: StoreTargetDimensions,
): StoreOutputFamilyResult {
  const placement = parseScreenPlacement(platform, device);
  if (!placement) throw new Error(`Unsupported platform/device pair: ${platform}/${device}`);

  const source = project.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);
  const sourceRootId = source.variantOf ?? source.id;
  const sourceRoot = project.screens.find((screen) => screen.id === sourceRootId);
  if (!sourceRoot || sourceRoot.variantOf !== undefined) {
    throw new Error(`Invalid root screen "${sourceRootId}"`);
  }

  const existing = project.screens.find((screen) =>
    screen.variantOf === undefined
    && screen.platform === placement.platform
    && screen.device === placement.device
    && screen.locale === sourceRoot.locale,
  );
  if (existing) return { project, firstScreen: existing, created: false };

  const sourceRoots = project.screens.filter((screen) =>
    screen.variantOf === undefined
    && screen.platform === sourceRoot.platform
    && screen.device === sourceRoot.device
    && screen.locale === sourceRoot.locale,
  );
  if (sourceRoots.length === 0) throw new Error(`No source output screens for "${sourceRootId}"`);

  const copies = sourceRoots.map((root) => {
    const copy = cloneScreenWithFreshIds(root);
    return ScreenSchema.parse({
      ...copy,
      ...placement,
      name: root.name,
      variantOf: undefined,
      storeTargetId: undefined,
      artboard: { width: leadTarget.width, height: leadTarget.height },
      elements: fitElementsToArtboard(copy.elements, root.artboard, leadTarget),
    });
  });
  const next = recomputeManifests({ ...project, screens: [...project.screens, ...copies] });
  return { project: next, firstScreen: copies[0]!, created: true };
}

/** Create one independent exact-target copy, or return the existing variant idempotently. */
export function ensureStoreTargetVariant(
  project: ProjectModel,
  sourceScreenId: string,
  target: StoreTargetDimensions,
): StoreTargetVariantResult {
  const source = project.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);
  const rootId = source.variantOf ?? source.id;
  const root = project.screens.find((screen) => screen.id === rootId);
  if (!root || root.variantOf !== undefined) throw new Error(`Invalid root screen "${rootId}"`);

  const existing = project.screens.find((screen) =>
    screen.variantOf === root.id && screen.storeTargetId === target.id,
  );
  if (existing) return { project, variant: existing, created: false };

  const copy = cloneScreenWithFreshIds(root);
  const variant = ScreenSchema.parse({
    ...copy,
    name: root.name,
    variantOf: root.id,
    storeTargetId: target.id,
    artboard: { width: target.width, height: target.height },
    elements: fitElementsToArtboard(copy.elements, root.artboard, target),
  });
  const next = recomputeManifests({
    ...project,
    screens: [...project.screens, variant],
  });
  return { project: next, variant, created: true };
}

export function removeStoreTargetVariant(
  project: ProjectModel,
  rootScreenId: string,
  storeTargetId: string,
): ProjectModel {
  const variant = project.screens.find((screen) =>
    screen.variantOf === rootScreenId && screen.storeTargetId === storeTargetId,
  );
  if (!variant) throw new Error(`Store target variant "${storeTargetId}" does not exist`);
  return removeScreenFromProject(project, variant.id);
}

/** Clone every screen in one locale as an independent target set, preserving source order. */
export function cloneLocaleSet(
  project: ProjectModel,
  sourceLocale: string,
  targetLocale: string,
  targetDirection?: LayoutDirection,
): ProjectModel {
  if (!targetLocale.trim()) throw new Error("Target locale must not be empty");

  const sourceScreens = project.screens.filter((screen) => screen.locale === sourceLocale);
  if (sourceScreens.length === 0) throw new Error(`Unknown source locale "${sourceLocale}"`);
  if (project.locales.includes(targetLocale)) {
    throw new Error(`Locale "${targetLocale}" already exists`);
  }

  const direction = targetDirection ?? sourceScreens[0]!.direction ?? "ltr";
  const rootIdMap = new Map<string, string>();
  const copies = sourceScreens.map((source) => {
    const copy = cloneScreenWithFreshIds(source);
    if (source.variantOf === undefined) rootIdMap.set(source.id, copy.id);
    return copy;
  }).map((copy, index) => {
    const source = sourceScreens[index]!;
    const variantOf = source.variantOf ? rootIdMap.get(source.variantOf) : undefined;
    if (source.variantOf && !variantOf) throw new Error(`Missing cloned root "${source.variantOf}"`);
    const localized = ScreenSchema.parse({ ...copy, name: source.name, locale: targetLocale });
    return setScreenDirection(
      ScreenSchema.parse({ ...localized, ...(variantOf ? { variantOf } : {}) }),
      direction,
    );
  });

  return recomputeManifests({
    ...project,
    screens: [...project.screens, ...copies],
  });
}

/** Remove an entire locale set without deleting any shared project assets. */
export function removeLocaleSet(project: ProjectModel, locale: string): ProjectModel {
  if (!project.locales.includes(locale)) throw new Error(`Unknown locale "${locale}"`);
  if (project.locales.length === 1) throw new Error("Cannot remove the last locale");

  return recomputeManifests({
    ...project,
    screens: project.screens.filter((screen) => screen.locale !== locale),
  });
}

/** Materialize a screen's opposite horizontal placement without reflecting media pixels. */
export function setScreenDirection(screen: Screen, direction: LayoutDirection): Screen {
  const currentDirection = screen.direction ?? "ltr";
  if (currentDirection === direction) return ScreenSchema.parse(screen);

  const elements = screen.elements.map((element) => mirrorElement(element, screen.artboard.width));

  return ScreenSchema.parse({ ...screen, direction, elements });
}

/** Change every screen in a locale together so the locale set keeps one direction. */
export function setLocaleDirection(
  project: ProjectModel,
  locale: string,
  direction: LayoutDirection,
): ProjectModel {
  if (!project.locales.includes(locale)) throw new Error(`Unknown locale "${locale}"`);
  if (project.screens
    .filter((screen) => screen.locale === locale)
    .every((screen) => screen.direction === direction)) return project;

  const screens = project.screens.map((screen) =>
    screen.locale === locale ? setScreenDirection(screen, direction) : screen,
  );
  return Project.parse({ ...project, screens });
}
