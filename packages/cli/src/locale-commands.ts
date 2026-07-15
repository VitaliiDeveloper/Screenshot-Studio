// SPDX-License-Identifier: Apache-2.0
import {
  cloneLocaleSet,
  removeLocaleSet,
  setLocaleDirection,
  type LayoutDirection,
  type Project,
} from "@screenshot-studio/core/model";
import type { ProjectLockOptions } from "@screenshot-studio/core/storage";
import { parseLayoutDirection } from "./direction.js";
import { loadProjectFile, updateProjectFile } from "./project-io.js";

export type LocaleAction =
  | { kind: "list" }
  | { kind: "add"; source: string; target: string; direction?: LayoutDirection }
  | { kind: "direction"; locale: string; direction: LayoutDirection }
  | { kind: "rm"; locale: string };

export function resolveLocaleAction(
  args: string[],
  flags: Record<string, string>,
): LocaleAction {
  const [subcommand, locale] = args;
  switch (subcommand) {
    case "list":
      return { kind: "list" };
    case "add": {
      if (!locale) throw new Error("Usage: screenshots locale add <target> --from <source> [--direction ltr|rtl]");
      if (!flags.from) throw new Error("locale add requires --from <source>");
      return {
        kind: "add",
        source: flags.from,
        target: locale,
        ...(flags.direction
          ? { direction: parseLayoutDirection(flags.direction, "--direction") }
          : {}),
      };
    }
    case "direction":
      if (!locale) throw new Error("Usage: screenshots locale direction <locale> --to <ltr|rtl>");
      if (!flags.to) throw new Error("locale direction requires --to <ltr|rtl>");
      return {
        kind: "direction",
        locale,
        direction: parseLayoutDirection(flags.to, "--to"),
      };
    case "rm":
      if (!locale) throw new Error("Usage: screenshots locale rm <locale>");
      return { kind: "rm", locale };
    default:
      throw new Error("Usage: screenshots locale <list|add|direction|rm>");
  }
}

export function formatLocaleList(project: Project): string {
  return project.locales.map((locale) => {
    const screens = project.screens.filter((screen) => screen.locale === locale);
    const direction = screens[0]!.direction;
    return `${locale} ${direction} ${screens.length} ${screens.length === 1 ? "screen" : "screens"}`;
  }).join("\n");
}

export async function runLocaleCommand(
  projectPath: string,
  args: string[],
  flags: Record<string, string>,
  lockOptions: ProjectLockOptions = {},
): Promise<string> {
  const action = resolveLocaleAction(args, flags);
  if (action.kind === "list") return formatLocaleList(await loadProjectFile(projectPath));

  const updated = await updateProjectFile(projectPath, (project) => {
    const nextProject = action.kind === "add"
      ? cloneLocaleSet(project, action.source, action.target, action.direction)
      : action.kind === "direction"
        ? setLocaleDirection(project, action.locale, action.direction)
        : removeLocaleSet(project, action.locale);

    return { project: nextProject, value: undefined };
  }, lockOptions);
  return formatLocaleList(updated.project);
}
