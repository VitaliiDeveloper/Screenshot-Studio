// SPDX-License-Identifier: Apache-2.0
import {
  Project,
  SCREEN_DEVICES_BY_PLATFORM,
  type Element,
  type Background,
  type LayoutDirection,
  type Platform,
  type Project as ProjectModel,
  type Screen,
} from "./schema.js";
import { cloneElementWithFreshIds } from "./element-tree.js";
import { recomputeManifests, slugify, titleFromId, uniqueId } from "./project-manifest.js";

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
