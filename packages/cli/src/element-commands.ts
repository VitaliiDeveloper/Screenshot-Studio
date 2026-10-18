// SPDX-License-Identifier: Apache-2.0
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  elementLeaves,
  findElementLocation,
  getLayout,
  isProjectRelativePath,
  mapElementLeaves,
  replaceLayout,
  type LeafElement,
  type Project,
} from "@screenshot-studio/core/model";
import { resolveExistingProjectPath } from "@screenshot-studio/core/storage";
import { assertInside } from "./asset-service.js";
import { resolveMutationLayout } from "./layout-commands.js";
import { assertProjectImageBytes, MAX_PROJECT_IMAGE_BYTES } from "./project-image-service.js";
import { loadProjectFile, updateProjectFile } from "./project-io.js";

export type ElementAction =
  | { kind: "list"; screen?: string; locale?: string }
  | { kind: "text"; screen: string; element: string; content: string }
  | { kind: "media"; screen: string; element: string; path: string };

const MEDIA_TYPES = new Set<LeafElement["type"]>(["screenshot", "image", "device-frame"]);

export function resolveElementAction(args: string[], flags: Record<string, string>): ElementAction {
  const [subcommand, screen, element, value, extra] = args;
  if (subcommand === "list" && !screen) {
    return { kind: "list", screen: flags.screen, locale: flags.locale };
  }
  if (subcommand === "text" && screen && element && value !== undefined && extra === undefined) {
    return { kind: "text", screen, element, content: value };
  }
  if (subcommand === "media" && screen && element && value && extra === undefined) {
    return { kind: "media", screen, element, path: value };
  }
  throw new Error(
    "Usage: screenshots element <list [--screen <id>] [--locale <locale>]|text <screen> <element> <content>|media <screen> <element> <path>>",
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
  if (screens.length === 0) throw new Error("No screens match the given --screen/--locale filters");
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
): Promise<string> {
  const action = resolveElementAction(args, flags);
  if (action.kind === "list") {
    const project = await loadProjectFile(projectPath);
    return formatElementList(project, resolveMutationLayout(project, flags.layout).id, action);
  }
  if (action.kind === "media") await assertProjectMediaFile(projectPath, action.path);

  await updateProjectFile(projectPath, (project) => {
    const layout = resolveMutationLayout(project, flags.layout);
    const nextProject = updateLeafInProject(project, layout.id, action.screen, action.element, (leaf) => {
      if (action.kind === "text") {
        if (leaf.type !== "text") throw new Error(`Element "${leaf.id}" is ${leaf.type}, not text`);
        return { ...leaf, content: action.content };
      }
      if (!MEDIA_TYPES.has(leaf.type)) {
        throw new Error(`Element "${leaf.id}" is ${leaf.type}; media needs screenshot, image, or device-frame`);
      }
      return { ...leaf, assetUrl: action.path } as LeafElement;
    });
    return { project: nextProject, value: undefined };
  });
  return `Updated ${action.kind} of ${action.screen}/${action.element}`;
}
