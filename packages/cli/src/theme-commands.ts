// SPDX-License-Identifier: Apache-2.0
import { applyThemeFile, themeId } from "./theme-service.js";

export type ThemeAction = { kind: "set"; id: string };

export function resolveThemeAction(args: string[]): ThemeAction {
  const [subcommand, id, extra] = args;
  if (subcommand !== "set" || !id || extra) {
    throw new Error("Usage: screenshots theme set <id>");
  }
  return { kind: "set", id: themeId(id) };
}

export async function runThemeCommand(projectPath: string, args: string[]): Promise<string> {
  const action = resolveThemeAction(args);
  const { theme } = await applyThemeFile(projectPath, action.id);
  return `Applied theme "${theme.name}" (${theme.id})`;
}
