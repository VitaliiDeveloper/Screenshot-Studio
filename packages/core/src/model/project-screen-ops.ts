// SPDX-License-Identifier: Apache-2.0
import {
  SCREEN_DEVICES_BY_PLATFORM,
  Screen as ScreenSchema,
  type Element,
  type Background,
  type LayoutDirection,
  type Platform,
  type Project as ProjectModel,
  type Screen,
} from "./schema.js";
import { cloneElementWithFreshIds } from "./element-tree.js";
import { slugify, titleFromId, uniqueId } from "./project-manifest.js";
import { getLayout, replaceLayout } from "./project-layout.js";
import { fitElementsToArtboard } from "./project-artboard-ops.js";
import {
  alignSynchronizedScreenSets,
  isPrimaryScreen,
  reorderSynchronizedScreenSets,
  sameOutputFamily,
  screenSetModeFor,
} from "./screen-set-policy.js";

/** Platform + device pairs allowed by the schema (no invalid cross products). */
export type ScreenPlacement = {
  [P in Platform]: { platform: P; device: (typeof SCREEN_DEVICES_BY_PLATFORM)[P][number] };
}[Platform];

export function parseScreenPlacement(platform: string, device: string): ScreenPlacement | null {
  if (!(platform in SCREEN_DEVICES_BY_PLATFORM)) return null;
  const typedPlatform = platform as Platform;
  const devices = SCREEN_DEVICES_BY_PLATFORM[typedPlatform] as readonly string[];
  return devices.includes(device) ? ({ platform: typedPlatform, device } as ScreenPlacement) : null;
}

/** @deprecated Prefer `parseScreenPlacement` when the validated pair is needed. */
export function isScreenPlacement(platform: string, device: string): boolean {
  return parseScreenPlacement(platform, device) !== null;
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
  if (input.platform === "windows") {
    return { ...base, platform: "windows", device: input.device };
  }
  return { ...base, platform: "web", device: input.device };
}

export function addScreenToProject(
  project: ProjectModel,
  layoutId: string,
  input: CreateScreenInput,
): ProjectModel {
  const layout = getLayout(project, layoutId);
  const baseId = slugify(
    input.id ?? input.name ?? `${input.platform}-${input.device}-${input.locale}`,
  );
  const id = uniqueId(baseId, layout.screens);
  const name = input.name ?? titleFromId(id);
  const localeDirection = layout.screens.find((screen) => screen.locale === input.locale)?.direction;
  const screen = createScreen({
    ...input,
    id,
    name,
    direction: input.direction ?? localeDirection ?? "ltr",
  });
  const synchronized = screenSetModeFor(layout, screen) === "synchronized";
  const targetScreens = synchronized
    ? Array.from(new Map(layout.screens
      .filter((candidate) => sameOutputFamily(candidate, screen) && candidate.storeTargetId)
      .map((candidate) => [candidate.storeTargetId!, candidate])).values())
    : [];
  const variants = targetScreens.map((targetScreen) => ScreenSchema.parse({
    ...cloneScreenWithFreshIds(screen),
    name: screen.name,
    variantOf: screen.id,
    storeTargetId: targetScreen.storeTargetId,
    artboard: { ...targetScreen.artboard },
    elements: fitElementsToArtboard(screen.elements, screen.artboard, targetScreen.artboard),
  }));
  const screens = synchronized
    ? alignSynchronizedScreenSets([...layout.screens, screen, ...variants], screen)
    : [...layout.screens, screen];
  return replaceLayout(project, { ...layout, screens });
}

export interface RemoveScreenOptions {
  cascadeVariants?: boolean;
}

export function removeScreenFromProject(
  project: ProjectModel,
  layoutId: string,
  id: string,
  options: RemoveScreenOptions = {},
): ProjectModel {
  const layout = getLayout(project, layoutId);
  const requested = layout.screens.find((screen) => screen.id === id);
  if (!requested) throw new Error(`Unknown screen "${id}"`);
  const synchronized = screenSetModeFor(layout, requested) === "synchronized";
  const removed = synchronized && requested.variantOf
    ? layout.screens.find((screen) => screen.id === requested.variantOf)!
    : requested;
  const cascadeVariants = synchronized || options.cascadeVariants === true;
  if (isPrimaryScreen(removed)) {
    const localeRoots = layout.screens.filter((screen) =>
      isPrimaryScreen(screen) && screen.locale === removed.locale
    );
    if (localeRoots.length === 1) {
      throw new Error(`Cannot remove the last root screen for locale "${removed.locale}"`);
    }
  }
  const screens = layout.screens.flatMap((screen) => {
    if (screen.id === removed.id) return [];
    if (screen.variantOf !== removed.id) return [screen];
    if (cascadeVariants) return [];
    const detached = structuredClone(screen);
    delete detached.variantOf;
    return [ScreenSchema.parse(detached)];
  });
  const familyStillExists = screens.some((screen) =>
    isPrimaryScreen(screen) && sameOutputFamily(screen, removed)
  );
  const screenSetPolicies = familyStillExists
    ? layout.screenSetPolicies
    : layout.screenSetPolicies?.filter((policy) => !(
      policy.platform === removed.platform
      && policy.device === removed.device
      && policy.locale === removed.locale
    ));
  return replaceLayout(project, { ...layout, screenSetPolicies, screens });
}

/** 1-based position (CLI / human-facing). */
export function reorderScreenInProject(
  project: ProjectModel,
  layoutId: string,
  id: string,
  position: number,
): ProjectModel {
  const layout = getLayout(project, layoutId);
  const from = layout.screens.findIndex((screen) => screen.id === id);
  if (from === -1) throw new Error(`Unknown screen "${id}"`);
  const screen = layout.screens[from]!;
  if (screenSetModeFor(layout, screen) === "synchronized") {
    const roots = layout.screens.filter((candidate) =>
      sameOutputFamily(candidate, screen) && isPrimaryScreen(candidate)
    );
    if (!Number.isInteger(position) || position < 1 || position > roots.length) {
      throw new Error(`Position must be between 1 and ${roots.length}`);
    }
    const fromRootId = screen.variantOf ?? screen.id;
    const toRootId = roots[position - 1]!.id;
    return replaceLayout(project, {
      ...layout,
      screens: reorderSynchronizedScreenSets(layout.screens, screen, fromRootId, toRootId),
    });
  }
  if (!Number.isInteger(position) || position < 1 || position > layout.screens.length) {
    throw new Error(`Position must be between 1 and ${layout.screens.length}`);
  }
  const screens = [...layout.screens];
  const [moved] = screens.splice(from, 1);
  screens.splice(position - 1, 0, moved!);
  return replaceLayout(project, { ...layout, screens });
}

/** Deep-clone a screen with fresh screen + element ids (editor "duplicate screen"). */
export function cloneScreenWithFreshIds(src: Screen): Screen {
  const copy = structuredClone(src);
  copy.id = crypto.randomUUID();
  copy.name = `${src.name} copy`;
  copy.elements = copy.elements.map((element) => cloneElementWithFreshIds(element));
  return copy;
}
