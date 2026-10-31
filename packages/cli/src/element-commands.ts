// SPDX-License-Identifier: Apache-2.0
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  applyElementPatch,
  createDeviceFrameElement,
  createIconElement,
  createImageElement,
  createScreenshotElement,
  createShapeElement,
  createTextElement,
  elementLeaves,
  findElementLocation,
  fitElementsToArtboard,
  fontIdentityKey,
  getLayout,
  isBuiltInFontIdentity,
  isProjectRelativePath,
  mapElementLeaves,
  parseProject,
  preferredAuthoringFont,
  replaceLayout,
  slotCounterpart,
  slotScreens,
  type DesignLayout,
  type DeviceFrameElement,
  type Element,
  type ElementPatch,
  type ElementPatchFor,
  type LeafElement,
  type Project,
  type Screen,
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
  | { kind: "get"; screen: string; element: string }
  | { kind: "set"; screen: string; element: string; patch: Record<string, unknown>; allSizes: boolean }
  | { kind: "add"; screen: string; type: AddableElementType; props: Record<string, unknown> }
  | { kind: "rm"; screen: string; element: string };

type AddableElementType = Exclude<Element["type"], "group">;

const GEOMETRY_FIELDS = ["x", "y", "width", "height", "rotation", "opacity"] as const;
type GeometryPatch = Partial<Record<typeof GEOMETRY_FIELDS[number], number>>;

const MEDIA_TYPES = new Set<LeafElement["type"]>(["screenshot", "image", "device-frame"]);
const ADDABLE_TYPES: readonly AddableElementType[] = ["text", "shape", "screenshot", "image", "icon", "device-frame"];

const COMMON_PATCH_KEYS = ["x", "y", "width", "height", "rotation", "opacity", "locked", "visible", "name"] as const;
const MEDIA_PATCH_KEYS = ["assetUrl", "fit", "cornerRadius", "crop", "blur"] as const;
// Mirrors ElementPatchFor so the CLI rejects keys applyElementPatch would silently ignore.
const PATCH_KEYS: { [T in Element["type"]]: ReadonlyArray<keyof ElementPatchFor<T>> } = {
  text: [
    ...COMMON_PATCH_KEYS, "role", "content", "fontFamily", "size", "weight", "lineHeight", "letterSpacing",
    "align", "verticalAlign", "color", "shadow",
  ],
  shape: [...COMMON_PATCH_KEYS, "role", "kind", "fill", "radius", "gradient", "stroke"],
  screenshot: [...COMMON_PATCH_KEYS, ...MEDIA_PATCH_KEYS],
  image: [...COMMON_PATCH_KEYS, ...MEDIA_PATCH_KEYS],
  icon: [...COMMON_PATCH_KEYS, "icon", "color", "strokeWidth"],
  "device-frame": [...COMMON_PATCH_KEYS, "assetUrl", "fit", "deviceType", "blur"],
  group: COMMON_PATCH_KEYS,
};

const USAGE = [
  "Usage: screenshots element <command>",
  "  list [--screen <id>] [--locale <locale>]",
  "  get <screen> <element>",
  "  text <screen> <element> [--all-sizes] [--] <content>",
  "  media <screen> <element> <path>",
  "  set <screen> <element> [--all-sizes] --json '<patch>'   (null removes an optional field)",
  `  add <screen> --type <${ADDABLE_TYPES.join("|")}> [--json '<props>']`,
  "  rm <screen> <element>",
].join("\n");

export function parseJsonObject(value: string | undefined, flag: string): Record<string, unknown> {
  if (value === undefined) throw new Error(`Missing --${flag} '<json object>'`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`--${flag} is not valid JSON: ${value}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`--${flag} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Only geometry can be fitted into another artboard, so --all-sizes accepts nothing else. */
function assertGeometryPatch(patch: Record<string, unknown>): asserts patch is GeometryPatch {
  const fields: readonly string[] = GEOMETRY_FIELDS;
  const other = Object.keys(patch).filter((key) => !fields.includes(key));
  if (other.length > 0) {
    throw new Error(`element set --all-sizes accepts only ${GEOMETRY_FIELDS.join(", ")}; got ${other.join(", ")}`);
  }
  for (const [field, value] of Object.entries(patch)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`element set --all-sizes needs "${field}" to be a finite number`);
    }
  }
}

export function resolveElementAction(args: string[], flags: Record<string, string>): ElementAction {
  const [subcommand, screen, element, value, extra] = args;
  if (flags["all-sizes"] === "true" && subcommand !== "text" && subcommand !== "set") {
    throw new Error("--all-sizes applies only to element text and element set");
  }
  if (flags.json !== undefined && subcommand !== "set" && subcommand !== "add") {
    throw new Error("--json applies only to element set and element add");
  }
  if (flags.type !== undefined && subcommand !== "add") throw new Error("--type applies only to element add");
  if (subcommand === "list" && !screen) {
    return { kind: "list", screen: flags.screen, locale: flags.locale };
  }
  if (subcommand === "text" && screen && element && value !== undefined && extra === undefined) {
    return { kind: "text", screen, element, content: value, allSizes: flags["all-sizes"] === "true" };
  }
  if (subcommand === "media" && screen && element && value && extra === undefined) {
    return { kind: "media", screen, element, path: value };
  }
  if ((subcommand === "get" || subcommand === "rm") && screen && element && value === undefined) {
    return { kind: subcommand, screen, element };
  }
  if (subcommand === "set" && screen && element && value === undefined) {
    const patch = parseJsonObject(flags.json, "json");
    const allSizes = flags["all-sizes"] === "true";
    if (allSizes) assertGeometryPatch(patch);
    return { kind: "set", screen, element, patch, allSizes };
  }
  if (subcommand === "add" && screen && element === undefined) {
    const type = flags.type as AddableElementType | undefined;
    if (!type || !ADDABLE_TYPES.includes(type)) {
      throw new Error(`element add requires --type <${ADDABLE_TYPES.join("|")}>`);
    }
    return { kind: "add", screen, type, props: flags.json === undefined ? {} : parseJsonObject(flags.json, "json") };
  }
  throw new Error(USAGE);
}

function requireScreen(layout: DesignLayout, screenId: string): Screen {
  const screen = layout.screens.find((candidate) => candidate.id === screenId);
  if (!screen) throw new Error(`Unknown screen "${screenId}"`);
  return screen;
}

function requireElement(screen: Screen, elementId: string): Element {
  const location = findElementLocation(screen, elementId);
  if (!location) throw new Error(`Unknown element "${elementId}" on screen "${screen.id}"`);
  return location.element;
}

function assertPatchKeys(type: Element["type"], patch: Record<string, unknown>): void {
  const allowed = PATCH_KEYS[type] as readonly string[];
  const unknown = Object.keys(patch).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`Cannot set ${unknown.join(", ")} on ${type}; settable fields: ${allowed.join(", ")}`);
  }
}

export function assertTextFontRegistered(project: Project, element: Element): void {
  if (element.type !== "text") return;
  const identity = { family: element.fontFamily, weight: element.weight };
  const key = fontIdentityKey(identity);
  if (isBuiltInFontIdentity(identity) || project.fonts.some((font) => fontIdentityKey(font) === key)) return;
  throw new Error(
    `Font "${identity.family}" ${identity.weight} is not registered; add it with screenshots font add first`,
  );
}

function createElement(type: AddableElementType, props: Record<string, unknown>, project: Project, screen: Screen): Element {
  switch (type) {
    case "text":
      return createTextElement({ font: preferredAuthoringFont(project.fonts), direction: screen.direction });
    case "shape":
      return createShapeElement();
    case "screenshot":
    case "image": {
      if (typeof props.assetUrl !== "string") throw new Error(`element add --type ${type} requires "assetUrl" in --json`);
      return type === "image"
        ? createImageElement({ assetUrl: props.assetUrl })
        : createScreenshotElement({ assetUrl: props.assetUrl });
    }
    case "icon":
      return createIconElement();
    case "device-frame":
      return createDeviceFrameElement(
        typeof props.deviceType === "string" ? { deviceType: props.deviceType as DeviceFrameElement["deviceType"] } : {},
      );
  }
}

function removeElement(elements: Element[], elementId: string): Element[] {
  // Matches the editor: removing a group's last child removes the group too.
  return elements.flatMap((element): Element[] => {
    if (element.id === elementId) return [];
    if (element.type !== "group") return [element];
    const children = element.children.filter((child) => child.id !== elementId);
    if (children.length === element.children.length) return [element];
    return children.length === 0 ? [] : [{ ...element, children }];
  });
}

/** Mutates a structured clone so applyElementPatch can edit nested group children in place. */
function editElementTree(
  project: Project,
  layoutReference: string | undefined,
  action: Extract<ElementAction, { kind: "set" | "add" | "rm" }>,
): { project: Project; message: string } {
  const next = structuredClone(project);
  const screen = requireScreen(resolveMutationLayout(next, layoutReference), action.screen);
  let message: string;
  if (action.kind === "rm") {
    requireElement(screen, action.element);
    screen.elements = removeElement(screen.elements, action.element);
    message = `Removed ${action.screen}/${action.element}`;
  } else {
    const element = action.kind === "set"
      ? requireElement(screen, action.element)
      : createElement(action.type, action.props, next, screen);
    const patch = action.kind === "set" ? action.patch : action.props;
    assertPatchKeys(element.type, patch);
    applyElementPatch(element, patch as ElementPatch);
    assertTextFontRegistered(next, element);
    if (action.kind === "add") screen.elements.push(element);
    message = `${action.kind === "set" ? "Updated" : `Added ${element.type}`} ${action.screen}/${element.id}`;
  }
  // parseProject reports schema violations by field path instead of a raw Zod dump.
  return { project: parseProject(next), message };
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

export async function assertProjectMediaFile(projectPath: string, assetPath: string): Promise<void> {
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
  if (action.kind === "get") {
    const project = await loadProjectFile(projectPath);
    const screen = requireScreen(resolveMutationLayout(project, flags.layout), action.screen);
    return JSON.stringify(requireElement(screen, action.element), null, 2);
  }
  if (action.kind === "media") await assertProjectMediaFile(projectPath, action.path);
  if ((action.kind === "set" && !action.allSizes) || action.kind === "add" || action.kind === "rm") {
    const media = action.kind === "set" ? action.patch.assetUrl : action.kind === "add" ? action.props.assetUrl : undefined;
    if (typeof media === "string") await assertProjectMediaFile(projectPath, media);
    const { value } = await updateProjectFile(projectPath, (project) => {
      const result = editElementTree(project, flags.layout, action);
      return { project: result.project, value: result.message };
    }, lockOptions);
    return value;
  }

  const { value } = await updateProjectFile(projectPath, (project) => {
    const layout = resolveMutationLayout(project, flags.layout);
    const { targets, skipped } = (action.kind === "text" || action.kind === "set") && action.allSizes
      ? slotTargets(layout, action.screen, action.element)
      : { targets: [{ screen: action.screen, element: action.element }], skipped: [] };
    const updated: typeof targets = [];
    const nextProject = targets.reduce((current, target) => {
      let patch: GeometryPatch | undefined;
      if (action.kind === "set") {
        patch = action.patch as GeometryPatch;
        if (target.screen !== action.screen) {
          try {
            patch = fittedGeometryPatch(layout, action.screen, action.element, target.screen, patch);
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
