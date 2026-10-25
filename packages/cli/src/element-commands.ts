// SPDX-License-Identifier: Apache-2.0
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  elementLeaves,
  findElementLocation,
  fitElementsToArtboard,
  getLayout,
  isProjectRelativePath,
  mapElementLeaves,
  replaceLayout,
  slotCounterpart,
  slotScreens,
  type DesignLayout,
  type Element,
  type LeafElement,
  type Project,
} from "@screenshot-studio/core/model";
import { resolveExistingProjectPath, type ProjectLockOptions } from "@screenshot-studio/core/storage";
import { assertInside } from "./asset-service.js";
import { resolveMutationLayout } from "./layout-commands.js";
import { assertProjectImageBytes, MAX_PROJECT_IMAGE_BYTES } from "./project-image-service.js";
import { loadProjectFile, updateProjectFile } from "./project-io.js";

export type ElementAction =
  | { kind: "list"; screen?: string; locale?: string }
  | { kind: "text"; screen: string; element: string; content: string; allSizes: boolean }
  | { kind: "media"; screen: string; element: string; path: string }
  | { kind: "set"; screen: string; element: string; patch: GeometryPatch; allSizes: boolean };

const GEOMETRY_FIELDS = ["x", "y", "width", "height", "rotation", "opacity"] as const;
type GeometryPatch = Partial<Record<typeof GEOMETRY_FIELDS[number], number>>;

const MEDIA_TYPES = new Set<LeafElement["type"]>(["screenshot", "image", "device-frame"]);

function parseGeometryPatch(flags: Record<string, string>): GeometryPatch {
  const patch: GeometryPatch = {};
  for (const field of GEOMETRY_FIELDS) {
    const raw = flags[field];
    if (raw === undefined) continue;
    const value = Number(raw);
    // Number("") is 0, and Infinity would be written as JSON null.
    if (raw.trim() === "" || !Number.isFinite(value)) throw new Error(`--${field} must be a finite number`);
    patch[field] = value;
  }
  return patch;
}

export function resolveElementAction(args: string[], flags: Record<string, string>): ElementAction {
  const [subcommand, screen, element, value, extra] = args;
  if (flags["all-sizes"] === "true" && subcommand !== "text" && subcommand !== "set") {
    throw new Error("--all-sizes applies only to element text and element set");
  }
  const patch = parseGeometryPatch(flags);
  if (Object.keys(patch).length > 0 && subcommand !== "set") {
    throw new Error(`--${GEOMETRY_FIELDS.join(", --")} apply only to element set`);
  }
  if (subcommand === "list" && !screen) {
    return { kind: "list", screen: flags.screen, locale: flags.locale };
  }
  if (subcommand === "text" && screen && element && value !== undefined && extra === undefined) {
    return { kind: "text", screen, element, content: value, allSizes: flags["all-sizes"] === "true" };
  }
  if (subcommand === "media" && screen && element && value && extra === undefined) {
    return { kind: "media", screen, element, path: value };
  }
  if (subcommand === "set" && screen && element && value === undefined) {
    if (Object.keys(patch).length === 0) {
      throw new Error(`element set needs at least one of --${GEOMETRY_FIELDS.join(", --")}`);
    }
    return { kind: "set", screen, element, patch, allSizes: flags["all-sizes"] === "true" };
  }
  throw new Error(
    "Usage: screenshots element <list [--screen <id>] [--locale <locale>]|text <screen> <element> [--all-sizes] [--] <content>|media <screen> <element> <path>|set <screen> <element> [--x <px>] [--y <px>] [--width <px>] [--height <px>] [--rotation <deg>] [--opacity <0-1>] [--all-sizes]>",
  );
}

function describeLeaf(leaf: LeafElement): string {
  const role = leaf.role ? ` role=${leaf.role}` : "";
  if (leaf.type === "text") return `${leaf.type}${role} ${JSON.stringify(leaf.content)}`;
  if (leaf.type === "screenshot" || leaf.type === "image" || leaf.type === "device-frame") {
    return `${leaf.type}${role} ${leaf.assetUrl ?? "-"}`;
  }
  return `${leaf.type}${role}`;
}

export function formatElementList(
  project: Project,
  layoutId: string,
  filters: { screen?: string; locale?: string } = {},
): string {
  const screens = getLayout(project, layoutId).screens.filter((screen) => (
    (!filters.screen || screen.id === filters.screen) && (!filters.locale || screen.locale === filters.locale)
  ));
  return screens.flatMap((screen) => screen.elements.flatMap(elementLeaves).map((leaf) => (
    `${screen.id} ${screen.locale} ${leaf.id} ${describeLeaf(leaf)}`
  ))).join("\n");
}

export function updateLeafInProject(
  project: Project,
  layoutId: string,
  screenId: string,
  elementId: string,
  update: (leaf: LeafElement) => LeafElement,
): Project {
  const layout = getLayout(project, layoutId);
  const screen = layout.screens.find((candidate) => candidate.id === screenId);
  if (!screen) throw new Error(`Unknown screen "${screenId}"`);
  const location = findElementLocation(screen, elementId);
  if (!location) throw new Error(`Unknown element "${elementId}" on screen "${screenId}"`);
  if (location.element.type === "group") {
    throw new Error(`Element "${elementId}" is a group; target one of its children`);
  }
  const elements = screen.elements.map((element) => mapElementLeaves(
    element,
    (leaf) => leaf.id === elementId ? update(leaf) : leaf,
  ));
  return replaceLayout(project, {
    ...layout,
    screens: layout.screens.map((candidate) => candidate.id === screenId ? { ...candidate, elements } : candidate),
  });
}

/**
 * The edited layer plus its counterpart on every other exact size of the slot, matched like the
 * editor's Status by size and Apply to; unmatched and locked counterparts are skipped.
 */
function slotTargets(layout: DesignLayout, screenId: string, elementId: string) {
  const targets = [{ screen: screenId, element: elementId }];
  const skipped: string[] = [];
  const source = layout.screens.find((candidate) => candidate.id === screenId);
  if (!source) return { targets, skipped };
  for (const screen of slotScreens(layout, source)) {
    if (screen.id === source.id) continue;
    const counterpart = slotCounterpart(source, elementId, screen);
    if (!counterpart) skipped.push(`Skipped ${screen.id}: layer structure differs from ${source.id}`);
    else if (counterpart.locked) skipped.push(`Skipped ${screen.id}/${counterpart.id}: layer is locked`);
    else if (findElementLocation(screen, counterpart.id)?.parent?.locked) {
      skipped.push(`Skipped ${screen.id}/${counterpart.id}: group is locked`);
    }
    else targets.push({ screen: screen.id, element: counterpart.id });
  }
  return { targets, skipped };
}

/**
 * The geometry a counterpart on another size takes: the edited layer with the patch applied, fitted
 * into that artboard the way the editor's Apply to does, so pixel fields scale and the rest copy.
 */
function fittedGeometryPatch(
  layout: DesignLayout,
  sourceId: string,
  elementId: string,
  targetId: string,
  patch: GeometryPatch,
): GeometryPatch {
  const source = layout.screens.find((screen) => screen.id === sourceId)!;
  const target = layout.screens.find((screen) => screen.id === targetId)!;
  const location = findElementLocation(source, elementId)!;
  const pick = (top: Element) => location.parent && top.type === "group"
    ? top.children.find((child) => child.id === elementId)!
    : top;
  const edited = structuredClone(location.parent ?? location.element);
  Object.assign(pick(edited), patch);
  const fitted = pick(fitElementsToArtboard([edited], source.artboard, target.artboard)[0]!);
  return Object.fromEntries(Object.keys(patch).map((field) => [field, fitted[field as keyof GeometryPatch]]));
}

async function assertProjectMediaFile(projectPath: string, assetPath: string): Promise<void> {
  if (!isProjectRelativePath(assetPath)) {
    throw new Error(`Media path must be project-relative (copy the file into the project first): ${assetPath}`);
  }
  const projectRoot = dirname(await resolveExistingProjectPath(projectPath));
  let target: string;
  try {
    target = await realpath(resolve(projectRoot, assetPath));
  } catch {
    throw new Error(`Media file not found in project: ${assetPath}`);
  }
  assertInside(projectRoot, target, "Media file");
  const file = await stat(target);
  if (!file.isFile()) throw new Error(`Media path is not a file: ${assetPath}`);
  if (file.size > MAX_PROJECT_IMAGE_BYTES) throw new Error(`Media file must be 25 MB or smaller: ${assetPath}`);
  await assertProjectImageBytes(await readFile(target));
}

export async function runElementCommand(
  projectPath: string,
  args: string[],
  flags: Record<string, string>,
  lockOptions: ProjectLockOptions = {},
): Promise<string> {
  const action = resolveElementAction(args, flags);
  if (action.kind === "list") {
    const project = await loadProjectFile(projectPath);
    return formatElementList(project, resolveMutationLayout(project, flags.layout).id, action);
  }
  if (action.kind === "media") await assertProjectMediaFile(projectPath, action.path);

  const { value } = await updateProjectFile(projectPath, (project) => {
    const layout = resolveMutationLayout(project, flags.layout);
    const { targets, skipped } = (action.kind === "text" || action.kind === "set") && action.allSizes
      ? slotTargets(layout, action.screen, action.element)
      : { targets: [{ screen: action.screen, element: action.element }], skipped: [] };
    const updated: typeof targets = [];
    const nextProject = targets.reduce((current, target) => {
      let patch: GeometryPatch | undefined;
      if (action.kind === "set") {
        patch = action.patch;
        if (target.screen !== action.screen) {
          try {
            patch = fittedGeometryPatch(layout, action.screen, action.element, target.screen, action.patch);
          } catch (error) {
            // Core prefixes a fitted value that leaves its range; anything else is a bug.
            if (!(error instanceof Error && error.message.startsWith("Cannot scale "))) throw error;
            skipped.push(`Skipped ${target.screen}/${target.element}: ${error.message}`);
            return current;
          }
        }
      }
      updated.push(target);
      return updateLeafInProject(current, layout.id, target.screen, target.element, (leaf) => {
        if (action.kind === "set") return { ...leaf, ...patch };
        if (action.kind === "text") {
          if (leaf.type !== "text") throw new Error(`Element "${leaf.id}" is ${leaf.type}, not text`);
          return { ...leaf, content: action.content };
        }
        if (!MEDIA_TYPES.has(leaf.type)) {
          throw new Error(`Element "${leaf.id}" is ${leaf.type}; media needs screenshot, image, or device-frame`);
        }
        return { ...leaf, assetUrl: action.path } as LeafElement;
      });
    }, project);
    const label = action.kind === "set" ? "geometry" : action.kind;
    return {
      project: nextProject,
      value: [...updated.map((target) => `Updated ${label} of ${target.screen}/${target.element}`), ...skipped],
    };
  }, lockOptions);
  return value.join("\n");
}
