// SPDX-License-Identifier: Apache-2.0
import {
  Project,
  Screen as ScreenSchema,
  SCREEN_DEVICES_BY_PLATFORM,
  type Element,
  type LayoutDirection,
  type Project as ProjectModel,
  type Screen,
} from "./schema.js";
import { fontIdentityKey, type FontIdentity } from "./font-identity.js";
import { cloneElementWithFreshIds, elementLeaves, mirrorElement } from "./element-tree.js";

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
export type ScreenPlacement =
  | { platform: "apple"; device: (typeof SCREEN_DEVICES_BY_PLATFORM.apple)[number] }
  | { platform: "android"; device: (typeof SCREEN_DEVICES_BY_PLATFORM.android)[number] };

export function isScreenPlacement(platform: string, device: string): boolean {
  return parseScreenPlacement(platform, device) !== null;
}

export function parseScreenPlacement(platform: string, device: string): ScreenPlacement | null {
  if (platform === "apple" && (device === "iphone" || device === "ipad")) {
    return { platform: "apple", device };
  }
  if (platform === "android" && device === "phone") {
    return { platform: "android", device };
  }
  return null;
}

export type CreateScreenInput = ScreenPlacement & {
  id?: string;
  name?: string;
  locale: string;
  direction?: LayoutDirection;
  artboard: { width: number; height: number };
  elements?: Element[];
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
    background: { type: "solid" as const, color: input.backgroundColor ?? "#101827" },
    elements: input.elements ?? [],
  };
  if (input.platform === "apple") {
    return { ...base, platform: "apple", device: input.device };
  }
  return { ...base, platform: "android", device: input.device };
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
  if (project.screens.length === 1) throw new Error("Cannot remove the last screen");
  const screens = project.screens.filter((screen) => screen.id !== id);
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
  const copies = sourceScreens.map((source) => {
    const copy = cloneScreenWithFreshIds(source);
    const localized = ScreenSchema.parse({ ...copy, name: source.name, locale: targetLocale });
    return setScreenDirection(localized, direction);
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
