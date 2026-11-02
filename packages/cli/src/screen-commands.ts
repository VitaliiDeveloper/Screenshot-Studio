// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import {
  addScreenToProject as addScreenToProjectCore,
  parseScreenPlacement,
  removeScreenFromProject,
  reorderScreenInProject,
  getLayout,
  parseProject,
  type CreateScreenInput,
  type LayoutDirection,
  type Project as ProjectModel,
  type Screen,
} from "@screenshot-studio/core/model";
import {
  findStoreSize,
  leadStoreSizeId,
  migrateLeadTarget,
  parseStoreSpecs,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import type { ProjectLockOptions } from "@screenshot-studio/core/storage";
import { assertProjectMediaFile, parseJsonObject } from "./element-commands.js";
import { rejectFlagsOutsideSubcommand } from "./command-flags.js";
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
  | { kind: "show"; id: string }
  | { kind: "set"; id: string; background: Record<string, unknown> }
  | { kind: "add"; options: AddScreenOptions }
  | { kind: "rm"; id: string; cascadeVariants?: boolean }
  | { kind: "reorder"; id: string; to: number }
  | { kind: "migrate-lead"; platform: string; device: string; from: string };

function requireFlag(flags: Record<string, string>, key: string, subcommand = "add"): string {
  const value = flags[key];
  if (!value) throw new Error(`screen ${subcommand} requires --${key}`);
  return value;
}

export function resolveScreenAction(args: string[], flags: Record<string, string>): ScreenAction {
  const [subcommand, id] = args;
  rejectFlagsOutsideSubcommand("screen", subcommand, flags, {
    json: ["show"],
    platform: ["add", "migrate-lead"],
    device: ["add", "migrate-lead"],
    locale: ["add"],
    id: ["add"],
    name: ["add"],
    direction: ["add"],
    size: ["add"],
    background: ["set"],
    cascade: ["rm"],
    to: ["reorder"],
    from: ["migrate-lead"],
  });
  switch (subcommand) {
    case "list":
      return { kind: "list" };
    case "show":
      // Output is always JSON; --json is accepted so the explicit form also works.
      if (!id) throw new Error("Usage: screenshots screen show <id> [--json]");
      return { kind: "show", id };
    case "set":
      if (!id) throw new Error("Usage: screenshots screen set <id> --background '<json>'");
      return { kind: "set", id, background: parseJsonObject(flags.background, "background") };
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
    case "migrate-lead": {
      const platform = requireFlag(flags, "platform", subcommand);
      const device = requireFlag(flags, "device", subcommand);
      if (!parseScreenPlacement(platform, device)) {
        throw new Error(`Unsupported platform/device pair: ${platform}/${device}`);
      }
      return { kind: "migrate-lead", platform, device, from: requireFlag(flags, "from", subcommand) };
    }
    default:
      throw new Error("Usage: screenshots screen <list|show|set|add|rm|reorder|migrate-lead>");
  }
}

export function formatScreenList(project: ProjectModel, layoutId: string): string {
  return getLayout(project, layoutId).screens
    .map(
      (screen, index) => {
        const target = screen.storeTargetId
          ? ` target=${screen.storeTargetId}${screen.variantOf ? ` variant-of=${screen.variantOf}` : ""}`
          : "";
        return `${index + 1} ${screen.id} ${screen.platform}/${screen.device} ${screen.locale} ${screen.name}${target}`;
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
  const leadSizeId = leadStoreSizeId(specs, placement.platform, placement.device);
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
  if (action.kind === "show") {
    const project = await loadProjectFile(projectPath);
    const screen = getLayout(project, resolveMutationLayout(project, flags.layout).id).screens
      .find((candidate) => candidate.id === action.id);
    if (!screen) throw new Error(`Unknown screen "${action.id}"`);
    return JSON.stringify(screen, null, 2);
  }
  if (action.kind === "set") {
    if (action.background.type === "image" && typeof action.background.assetUrl === "string") {
      await assertProjectMediaFile(projectPath, action.background.assetUrl);
    }
    await updateProjectFile(projectPath, (project) => {
      const layout = resolveMutationLayout(project, flags.layout);
      if (!layout.screens.some((screen) => screen.id === action.id)) throw new Error(`Unknown screen "${action.id}"`);
      const layouts = project.layouts.map((candidate) => candidate.id !== layout.id ? candidate : {
        ...candidate,
        screens: candidate.screens.map((screen) => screen.id === action.id
          ? { ...screen, background: action.background as Screen["background"] }
          : screen),
      });
      // Not replaceLayout: parseProject applies defaults and reports violations by field path.
      return { project: parseProject({ ...project, layouts }), value: undefined };
    }, lockOptions);
    return `Updated background of ${action.id}`;
  }
  if (action.kind === "migrate-lead") {
    const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
    const { value: migrated } = await updateProjectFile(projectPath, (project) => {
      const result = migrateLeadTarget(project, specs, action.platform, action.device, action.from);
      return { project: result.project, value: result.migrated };
    }, lockOptions);
    if (migrated.length === 0) {
      return `No ${action.platform}/${action.device} primary screens need migration from "${action.from}"`;
    }
    return migrated.map(({ layoutId, locale, screens }) =>
      `Migrated ${screens} ${action.platform}/${action.device} ${locale} primary screen(s) in layout ${layoutId}`
    ).join("\n");
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
