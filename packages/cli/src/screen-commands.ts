import { readFile } from "node:fs/promises";
import { Project, type Project as ProjectModel, type Screen } from "@screenshot-studio/core/model";
import {
  findStoreSize,
  leadStoreSizeId,
  parseStoreSpecs,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { loadProjectFile, writeProjectFile } from "./project-io.js";

export interface AddScreenOptions {
  id?: string;
  name?: string;
  platform: Screen["platform"];
  device: Screen["device"];
  locale: string;
  sizeId?: string;
}

export type ScreenAction =
  | { kind: "list" }
  | { kind: "add"; options: AddScreenOptions }
  | { kind: "rm"; id: string }
  | { kind: "reorder"; id: string; to: number };

function requireFlag(flags: Record<string, string>, key: string): string {
  const value = flags[key];
  if (!value) throw new Error(`screen add requires --${key}`);
  return value;
}

export function resolveScreenAction(args: string[], flags: Record<string, string>): ScreenAction {
  const [subcommand, id] = args;
  switch (subcommand) {
    case "list":
      return { kind: "list" };
    case "add":
      return {
        kind: "add",
        options: {
          id: flags.id,
          name: flags.name,
          platform: requireFlag(flags, "platform") as Screen["platform"],
          device: requireFlag(flags, "device") as Screen["device"],
          locale: requireFlag(flags, "locale"),
          sizeId: flags.size,
        },
      };
    case "rm":
      if (!id) throw new Error("Usage: screenshots screen rm <id>");
      return { kind: "rm", id };
    case "reorder": {
      if (!id) throw new Error("Usage: screenshots screen reorder <id> --to <position>");
      const to = Number(flags.to);
      if (!Number.isInteger(to)) throw new Error("screen reorder requires --to <position>");
      return { kind: "reorder", id, to };
    }
    default:
      throw new Error("Usage: screenshots screen <list|add|rm|reorder>");
  }
}

function titleFromId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "screen"
  );
}

function uniqueId(base: string, screens: Screen[]): string {
  const used = new Set(screens.map((screen) => screen.id));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

function recomputeManifests(project: ProjectModel): ProjectModel {
  const platforms = Array.from(new Set(project.screens.map((screen) => screen.platform)));
  const locales = Array.from(new Set(project.screens.map((screen) => screen.locale)));
  return Project.parse({ ...project, platforms, locales });
}

export function formatScreenList(project: ProjectModel): string {
  return project.screens
    .map(
      (screen, index) =>
        `${index + 1} ${screen.id} ${screen.platform}/${screen.device} ${screen.locale} ${screen.name}`,
    )
    .join("\n");
}

export function addScreenToProject(
  project: ProjectModel,
  specs: StoreSpecs,
  options: AddScreenOptions,
): ProjectModel {
  const baseId = slugify(options.id ?? options.name ?? `${options.platform}-${options.device}-${options.locale}`);
  const id = uniqueId(baseId, project.screens);
  const name = options.name ?? titleFromId(id);
  const target = findStoreSize(
    specs,
    options.platform,
    options.device,
    options.sizeId ?? leadStoreSizeId(options.platform, options.device),
  );
  const screen = {
    id,
    name,
    platform: options.platform,
    device: options.device,
    locale: options.locale,
    artboard: { width: target.width, height: target.height },
    background: { type: "solid", color: "#101827" },
    elements: [],
  };
  return recomputeManifests({ ...project, screens: [...project.screens, screen] } as ProjectModel);
}

export function removeScreenFromProject(project: ProjectModel, id: string): ProjectModel {
  const index = project.screens.findIndex((screen) => screen.id === id);
  if (index === -1) throw new Error(`Unknown screen "${id}"`);
  if (project.screens.length === 1) throw new Error("Cannot remove the last screen");
  const screens = project.screens.filter((screen) => screen.id !== id);
  return recomputeManifests({ ...project, screens } as ProjectModel);
}

export function reorderScreenInProject(project: ProjectModel, id: string, position: number): ProjectModel {
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

export async function runScreenCommand(
  projectPath: string,
  storeSpecsPath: string,
  args: string[],
  flags: Record<string, string>,
): Promise<string> {
  const action = resolveScreenAction(args, flags);
  const project = await loadProjectFile(projectPath);
  if (action.kind === "list") return formatScreenList(project);

  let nextProject: ProjectModel;
  if (action.kind === "add") {
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    nextProject = addScreenToProject(project, specs, action.options);
  } else if (action.kind === "rm") {
    nextProject = removeScreenFromProject(project, action.id);
  } else {
    nextProject = reorderScreenInProject(project, action.id, action.to);
  }

  await writeProjectFile(projectPath, nextProject);
  return formatScreenList(nextProject);
}
