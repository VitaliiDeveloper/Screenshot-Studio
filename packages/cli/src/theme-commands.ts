// SPDX-License-Identifier: Apache-2.0
import { listBuiltInDesignPacks } from "@screenshot-studio/core/themes";
import { applyBuiltInDesignPackFile, applyThemeFile, listThemes, themeId } from "./theme-service.js";

export type ThemeAction =
  | { kind: "list" }
  | { kind: "set"; id: string; builtIn: boolean };

export function resolveThemeAction(args: string[], flags: Record<string, string> = {}): ThemeAction {
  const [subcommand, id, extra] = args;
  if (subcommand === "list" && !id) return { kind: "list" };
  if (subcommand !== "set" || !id || extra) {
    throw new Error("Usage: screenshots theme <list|set <id> [--built-in]>");
  }
  return { kind: "set", id: themeId(id), builtIn: flags["built-in"] === "true" };
}

export async function runThemeCommand(
  projectPath: string,
  args: string[],
  flags: Record<string, string> = {},
): Promise<string> {
  const action = resolveThemeAction(args, flags);
  if (action.kind === "list") {
    const themes = await listThemes(projectPath);
    return [
      ...listBuiltInDesignPacks().map((pack) => `built-in ${pack.id} ${pack.name}`),
      ...themes.map((theme) => `project ${theme.id} ${theme.name}`),
    ].join("\n");
  }
  if (action.builtIn) {
    const { pack } = await applyBuiltInDesignPackFile(projectPath, action.id, {}, flags.layout);
    return `Applied built-in design pack "${pack.name}" (${pack.id})`;
  }
  const { theme } = await applyThemeFile(projectPath, action.id, {}, flags.layout);
  return `Applied theme "${theme.name}" (${theme.id})`;
}
