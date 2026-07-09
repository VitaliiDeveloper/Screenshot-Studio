import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { applyTheme, parseThemeJson } from "@screenshot-studio/core/themes";
import { loadProjectFile, writeProjectFile } from "./project-io.js";

export type ThemeAction = { kind: "set"; id: string };

export function resolveThemeAction(args: string[]): ThemeAction {
  const [subcommand, id, extra] = args;
  if (subcommand !== "set" || !id || extra) {
    throw new Error("Usage: screenshots theme set <id>");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("Theme id must be a lowercase slug");
  }
  return { kind: "set", id };
}

export async function runThemeCommand(projectPath: string, args: string[]): Promise<string> {
  const action = resolveThemeAction(args);
  const themePath = join(dirname(projectPath), "themes", `${action.id}.json`);
  let json: string;
  try {
    json = await readFile(themePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Theme "${action.id}" not found at ${themePath}`, { cause: error });
    }
    throw error;
  }
  const theme = parseThemeJson(json);
  if (theme.id !== action.id) {
    throw new Error(`Theme file id "${theme.id}" does not match requested id "${action.id}"`);
  }
  const nextProject = applyTheme(await loadProjectFile(projectPath), theme);
  await writeProjectFile(projectPath, nextProject);
  return `Applied theme "${theme.name}" (${theme.id})`;
}
