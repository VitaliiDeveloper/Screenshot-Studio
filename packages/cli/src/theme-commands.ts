// SPDX-License-Identifier: Apache-2.0
import { listBuiltInDesignPacks } from "@screenshot-studio/core/themes";
import {
  applyBuiltInDesignPackFile,
  applyProjectDesignPackFile,
  applyThemeFile,
  listThemesWithErrors,
  themeId,
} from "./theme-service.js";
import { loadProjectPackListing } from "./template-service.js";

export type ThemeAction =
  | { kind: "list" }
  | { kind: "set"; id: string; source: "project" | "built-in" | "pack" };

export function resolveThemeAction(args: string[], flags: Record<string, string> = {}): ThemeAction {
  const [subcommand, id, extra] = args;
  if (subcommand === "list" && !id) return { kind: "list" };
  if (subcommand !== "set" || !id || extra) {
    throw new Error("Usage: screenshots theme <list|set <id> [--built-in|--pack]>");
  }
  const builtIn = flags["built-in"] === "true";
  const pack = flags.pack === "true";
  if (builtIn && pack) throw new Error("theme set takes either --built-in or --pack, not both");
  return { kind: "set", id: themeId(id), source: pack ? "pack" : builtIn ? "built-in" : "project" };
}

export async function runThemeCommand(
  projectPath: string,
  args: string[],
  flags: Record<string, string> = {},
): Promise<string> {
  const action = resolveThemeAction(args, flags);
  if (action.kind === "list") {
    const [{ definitions: themes, errors }, local] = await Promise.all([
      listThemesWithErrors(projectPath),
      loadProjectPackListing(projectPath),
    ]);
    return [
      ...listBuiltInDesignPacks().map((pack) => `built-in ${pack.id} ${pack.name}`),
      ...local.packs.flatMap((entry) => entry.kind === "design" ? [`project-pack ${entry.pack.id} ${entry.pack.name}`] : []),
      ...themes.map((theme) => `project ${theme.id} ${theme.name}`),
      ...local.errors.map((error) => `invalid-pack ${error.file}: ${error.message}`),
      ...errors.map(({ file, error }) => `invalid-theme ${file}: ${error.message}`),
    ].join("\n");
  }
  if (action.source !== "project") {
    const builtIn = action.source === "built-in";
    const { pack } = await (builtIn ? applyBuiltInDesignPackFile : applyProjectDesignPackFile)(projectPath, action.id, {}, flags.layout);
    return `Applied ${builtIn ? "built-in" : "project"} design pack "${pack.name}" (${pack.id})`;
  }
  const { theme } = await applyThemeFile(projectPath, action.id, {}, flags.layout);
  return `Applied theme "${theme.name}" (${theme.id})`;
}
