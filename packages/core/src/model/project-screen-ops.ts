// SPDX-License-Identifier: Apache-2.0
import {
  SCREEN_DEVICES_BY_PLATFORM,
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
  return { ...base, platform: "windows", device: input.device };
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
  return replaceLayout(project, { ...layout, screens: [...layout.screens, screen] });
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
  const removed = layout.screens.find((screen) => screen.id === id);
  if (!removed) throw new Error(`Unknown screen "${id}"`);
  if (removed.variantOf === undefined) {
    const localeRoots = layout.screens.filter((screen) =>
      screen.variantOf === undefined && screen.locale === removed.locale
    );
    if (localeRoots.length === 1) {
      throw new Error(`Cannot remove the last root screen for locale "${removed.locale}"`);
    }
    const variants = layout.screens.filter((screen) => screen.variantOf === id);
    if (variants.length > 0 && !options.cascadeVariants) {
      throw new Error(
        `Screen "${id}" has ${variants.length} store target variant(s); rerun with cascade acknowledgement`,
      );
    }
  }
  const screens = layout.screens.filter((screen) =>
    screen.id !== id && screen.variantOf !== id,
  );
  return replaceLayout(project, { ...layout, screens });
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
  if (!Number.isInteger(position) || position < 1 || position > layout.screens.length) {
    throw new Error(`Position must be between 1 and ${layout.screens.length}`);
  }
  const screens = [...layout.screens];
  const [screen] = screens.splice(from, 1);
  screens.splice(position - 1, 0, screen!);
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
