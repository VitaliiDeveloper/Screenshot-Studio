// SPDX-License-Identifier: Apache-2.0
import type {
  Background,
  CanvasMode,
  DesignLayout,
  LayoutDirection,
  Project,
  Screen,
} from "./schema.js";
import { Project as ProjectSchema, Screen as ScreenSchema } from "./schema.js";
import { cloneElementWithFreshIds } from "./element-tree.js";
import { slugify, uniqueId } from "./project-manifest.js";

export interface AddLayoutInput {
  id?: string;
  name: string;
  mode: CanvasMode;
  screen: Pick<Screen, "platform" | "device" | "locale" | "artboard"> & {
    direction?: LayoutDirection;
    background?: Background;
  };
}

export interface LayoutMutationResult {
  project: Project;
  layout: DesignLayout;
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function validatedName(project: Project, value: string, exceptId?: string): string {
  const name = value.trim();
  if (!name) throw new Error("Layout name must not be empty");
  if (project.layouts.some((layout) =>
    layout.id !== exceptId && normalizedName(layout.name) === normalizedName(name)
  )) {
    throw new Error(`A layout named "${name}" already exists`);
  }
  return name;
}

export function getLayout(project: Project, layoutId: string): DesignLayout {
  const layout = project.layouts.find((candidate) => candidate.id === layoutId);
  if (!layout) {
    const known = project.layouts.map((candidate) => candidate.id).join(", ");
    throw new Error(`Layout "${layoutId}" not found. Known layouts: ${known}`);
  }
  return layout;
}

export function getPreferredExportLayout(project: Project): DesignLayout {
  return getLayout(project, project.preferredExportLayoutId);
}

export function resolveLayoutReference(project: Project, reference?: string): DesignLayout {
  if (reference === undefined) return getPreferredExportLayout(project);
  const byId = project.layouts.find((layout) => layout.id === reference);
  if (byId) return byId;
  const normalized = normalizedName(reference);
  const byName = project.layouts.find((layout) => normalizedName(layout.name) === normalized);
  if (byName) return byName;
  throw new Error(`Unknown layout "${reference}"`);
}

export function layoutLocales(layout: DesignLayout): string[] {
  return Array.from(new Set(layout.screens.map((screen) => screen.locale)));
}

export function layoutPlatforms(layout: DesignLayout): Screen["platform"][] {
  return Array.from(new Set(layout.screens.map((screen) => screen.platform)));
}

export function replaceLayout(project: Project, layout: DesignLayout): Project {
  if (!project.layouts.some((candidate) => candidate.id === layout.id)) {
    throw new Error(`Layout "${layout.id}" not found`);
  }
  return ProjectSchema.parse({
    ...project,
    layouts: project.layouts.map((candidate) => candidate.id === layout.id ? layout : candidate),
  });
}

export function addLayout(project: Project, input: AddLayoutInput): LayoutMutationResult {
  const name = validatedName(project, input.name);
  const id = uniqueId(slugify(input.id ?? name), project.layouts);
  const screen = ScreenSchema.parse({
    ...input.screen,
    id: crypto.randomUUID(),
    name: "Screen 1",
    direction: input.screen.direction ?? "ltr",
    background: input.screen.background ?? { type: "solid", color: "#101827" },
    elements: [],
  });
  const layout: DesignLayout = { id, name, mode: input.mode, screens: [screen] };
  const next = ProjectSchema.parse({ ...project, layouts: [...project.layouts, layout] });
  return { project: next, layout: getLayout(next, id) };
}

export function duplicateLayout(
  project: Project,
  reference: string,
  requestedName?: string,
): LayoutMutationResult {
  const source = resolveLayoutReference(project, reference);
  const name = validatedName(project, requestedName ?? `${source.name} Copy`);
  const id = uniqueId(slugify(name), project.layouts);
  const screenIds = new Map(source.screens.map((screen) => [screen.id, crypto.randomUUID()]));
  const screens = source.screens.map((screen) => ScreenSchema.parse({
    ...structuredClone(screen),
    id: screenIds.get(screen.id)!,
    ...(screen.variantOf ? { variantOf: screenIds.get(screen.variantOf) } : {}),
    elements: screen.elements.map((element) => cloneElementWithFreshIds(element)),
  }));
  const layout: DesignLayout = { id, name, mode: source.mode, screens };
  const sourceIndex = project.layouts.findIndex((candidate) => candidate.id === source.id);
  const layouts = [...project.layouts];
  layouts.splice(sourceIndex + 1, 0, layout);
  const next = ProjectSchema.parse({ ...project, layouts });
  return { project: next, layout: getLayout(next, id) };
}

export function renameLayout(project: Project, reference: string, requestedName: string): Project {
  const layout = resolveLayoutReference(project, reference);
  const name = validatedName(project, requestedName, layout.id);
  return replaceLayout(project, { ...layout, name });
}

export function setLayoutMode(project: Project, reference: string, mode: CanvasMode): Project {
  const layout = resolveLayoutReference(project, reference);
  if (layout.mode === mode) return project;
  return replaceLayout(project, { ...layout, mode });
}

export function preferLayout(project: Project, reference: string): Project {
  const layout = resolveLayoutReference(project, reference);
  if (project.preferredExportLayoutId === layout.id) return project;
  return ProjectSchema.parse({ ...project, preferredExportLayoutId: layout.id });
}

export function removeLayout(project: Project, reference: string): LayoutMutationResult {
  if (project.layouts.length === 1) throw new Error("Cannot remove the last layout");
  const removed = resolveLayoutReference(project, reference);
  const removedIndex = project.layouts.findIndex((layout) => layout.id === removed.id);
  const layouts = project.layouts.filter((layout) => layout.id !== removed.id);
  const replacement = layouts[Math.min(removedIndex, layouts.length - 1)]!;
  const preferredExportLayoutId = project.preferredExportLayoutId === removed.id
    ? replacement.id
    : project.preferredExportLayoutId;
  const next = ProjectSchema.parse({ ...project, preferredExportLayoutId, layouts });
  return { project: next, layout: getLayout(next, replacement.id) };
}
