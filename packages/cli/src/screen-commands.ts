// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import {
  addScreenToProject as addScreenToProjectCore,
  parseScreenPlacement,
  removeScreenFromProject,
  reorderScreenInProject,
  getLayout,
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
import type { ProjectLockOptions } from "@screenshot-studio/core/storage";
import { loadProjectFile, updateProjectFile } from "./project-io.js";
import { parseLayoutDirection } from "./direction.js";
import { resolveMutationLayout } from "./layout-commands.js";

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
  | { kind: "rm"; id: string; cascadeVariants?: boolean }
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
      return {
        kind: "rm",
        id,
        ...(flags.cascade === "true" ? { cascadeVariants: true } : {}),
      };
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

export function formatScreenList(project: ProjectModel, layoutId: string): string {
  return getLayout(project, layoutId).screens
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
  layoutId: string,
  specs: StoreSpecs,
  options: AddScreenOptions,
): ProjectModel {
  const placement = parseScreenPlacement(options.platform, options.device);
  if (!placement) {
    throw new Error(`Unsupported platform/device pair: ${options.platform}/${options.device}`);
  }
  const leadSizeId = leadStoreSizeId(placement.platform, placement.device);
  const target = findStoreSize(
    specs,
    placement.platform,
    placement.device,
    options.sizeId ?? leadSizeId,
  );
  if (options.sizeId !== undefined && target.id !== leadSizeId) {
    throw new Error(
      `Cannot create a root screen at non-lead store size "${options.sizeId}"; create a store target variant instead`,
    );
  }
  const input: CreateScreenInput = {
    ...placement,
    id: options.id,
    name: options.name,
    locale: options.locale,
    direction: options.direction,
    artboard: { width: target.width, height: target.height },
  };
  return addScreenToProjectCore(project, layoutId, input);
}

export { removeScreenFromProject, reorderScreenInProject };

export async function runScreenCommand(
  projectPath: string,
  storeSpecsPath: string,
  args: string[],
  flags: Record<string, string>,
  lockOptions: ProjectLockOptions = {},
): Promise<string> {
  const action = resolveScreenAction(args, flags);
  if (action.kind === "list") {
    const project = await loadProjectFile(projectPath);
    const layout = resolveMutationLayout(project, flags.layout);
    return formatScreenList(project, layout.id);
  }

  const updated = await updateProjectFile(projectPath, async (project) => {
    const layout = resolveMutationLayout(project, flags.layout);
    let nextProject: ProjectModel;
    if (action.kind === "add") {
      const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
      nextProject = addScreenToProject(project, layout.id, specs, action.options);
    } else if (action.kind === "rm") {
      nextProject = removeScreenFromProject(project, layout.id, action.id, {
        cascadeVariants: action.cascadeVariants,
      });
    } else {
      nextProject = reorderScreenInProject(project, layout.id, action.id, action.to);
    }

    return { project: nextProject, value: layout.id };
  }, lockOptions);
  return formatScreenList(updated.project, updated.value);
}
