// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import {
  DEFAULT_FONT_WEIGHT,
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  type Project as ProjectModel,
} from "@screenshot-studio/core/model";
import { loadProjectFile } from "./project-io.js";
import {
  addGoogleFont,
  addUploadedFontFile,
  fontWeight,
  removeFont,
  type FontServiceDependencies,
} from "./font-service.js";

export type FontAction =
  | { kind: "list" }
  | { kind: "add"; source: "uploaded"; file: string; family: string; weight: number }
  | { kind: "add"; source: "google"; family: string; weight: number }
  | { kind: "rm"; family: string; weight: number };

export type FontCommandDependencies = FontServiceDependencies;

function flagWeight(flags: Record<string, string>): number {
  try {
    return fontWeight(flags.weight ?? String(DEFAULT_FONT_WEIGHT));
  } catch {
    throw new Error(`--weight must be an integer from ${FONT_WEIGHT_MIN} through ${FONT_WEIGHT_MAX}`);
  }
}

export function resolveFontAction(args: string[], flags: Record<string, string>): FontAction {
  const [subcommand, value] = args;
  switch (subcommand) {
    case "list":
      return { kind: "list" };
    case "add": {
      const weight = flagWeight(flags);
      if (flags.google) {
        if (value) throw new Error("font add accepts either <file> or --google <family>, not both");
        return { kind: "add", source: "google", family: flags.google, weight };
      }
      if (!value) throw new Error("Usage: screenshots font add <file> --family <family> [--weight <100..900>]");
      if (!flags.family) throw new Error("font add <file> requires --family <family>");
      return { kind: "add", source: "uploaded", file: resolve(value), family: flags.family, weight };
    }
    case "rm":
      if (!value) throw new Error("Usage: screenshots font rm <family> [--weight <100..900>]");
      return { kind: "rm", family: value, weight: flagWeight(flags) };
    default:
      throw new Error("Usage: screenshots font <add|list|rm>");
  }
}

export function formatFontList(project: ProjectModel): string {
  return project.fonts.map((font) => `${font.family} ${font.weight} ${font.source} ${font.path}`).join("\n");
}

export async function runFontCommand(
  projectPath: string,
  args: string[],
  flags: Record<string, string>,
  dependencies: FontCommandDependencies = {},
): Promise<string> {
  const action = resolveFontAction(args, flags);
  if (action.kind === "list") return formatFontList(await loadProjectFile(projectPath));

  if (action.kind === "rm") {
    const nextProject = await removeFont(projectPath, action);
    return formatFontList(nextProject);
  }

  const nextProject = action.source === "uploaded"
    ? await addUploadedFontFile(projectPath, action)
    : await addGoogleFont(projectPath, action, dependencies);
  return formatFontList(nextProject);
}
