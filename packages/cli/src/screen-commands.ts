// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import {
  addScreenToProject as addScreenToProjectCore,
  parseScreenPlacement,
  removeScreenFromProject,
  reorderScreenInProject,
  type CreateScreenInput,
  type LayoutDirection,
  type Project as ProjectModel,
  type Screen,
} from "@screenshot-studio/core/model";
import {
  findStoreSize,
  leadStoreSizeId,
  parseStoreSpecs,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { loadProjectFile, writeProjectFile } from "./project-io.js";
import { parseLayoutDirection } from "./direction.js";

export interface AddScreenOptions {
  id?: string;
  name?: string;
  platform: Screen["platform"];
  device: Screen["device"];
  locale: string;
  direction?: LayoutDirection;
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
    case "add": {
      const platform = requireFlag(flags, "platform");
      const device = requireFlag(flags, "device");
      const placement = parseScreenPlacement(platform, device);
      if (!placement) {
        throw new Error(`Unsupported platform/device pair: ${platform}/${device}`);
      }
      return {
        kind: "add",
        options: {
          id: flags.id,
          name: flags.name,
          platform: placement.platform,
          device: placement.device,
          locale: requireFlag(flags, "locale"),
          ...(flags.direction
            ? { direction: parseLayoutDirection(flags.direction, "--direction") }
            : {}),
          sizeId: flags.size,
        },
      };
    }
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

export function formatScreenList(project: ProjectModel): string {
  return project.screens
    .map(
      (screen, index) => {
        const variant = screen.variantOf
          ? ` target=${screen.storeTargetId} variant-of=${screen.variantOf}`
          : "";
        return `${index + 1} ${screen.id} ${screen.platform}/${screen.device} ${screen.locale} ${screen.name}${variant}`;
      },
    )
    .join("\n");
}

/** Resolve lead (or explicit) store size into artboard dims, then append via core. */
export function addScreenToProject(
  project: ProjectModel,
  specs: StoreSpecs,
  options: AddScreenOptions,
): ProjectModel {
  const placement = parseScreenPlacement(options.platform, options.device);
  if (!placement) {
    throw new Error(`Unsupported platform/device pair: ${options.platform}/${options.device}`);
  }
  const target = findStoreSize(
    specs,
    placement.platform,
    placement.device,
    options.sizeId ?? leadStoreSizeId(placement.platform, placement.device),
  );
  const input: CreateScreenInput = {
    ...placement,
    id: options.id,
    name: options.name,
    locale: options.locale,
    direction: options.direction,
    artboard: { width: target.width, height: target.height },
  };
  return addScreenToProjectCore(project, input);
}

export { removeScreenFromProject, reorderScreenInProject };

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
