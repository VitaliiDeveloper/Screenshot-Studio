// SPDX-License-Identifier: Apache-2.0
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { applyTheme, parseThemeJson, type Theme } from "@screenshot-studio/core/themes";
import type { Project } from "@screenshot-studio/core/model";
import {
  resolveExistingProjectPath,
  type ProjectLockOptions,
} from "@screenshot-studio/core/storage";
import { updateProjectFile } from "./project-io.js";

const THEME_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ThemeValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThemeValidationError";
  }
}

export class ThemeNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThemeNotFoundError";
  }
}

export class ThemeApplyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ThemeApplyError";
  }
}

export function themeId(value: unknown): string {
  if (typeof value !== "string" || !THEME_ID.test(value)) {
    throw new ThemeValidationError("Theme id must be a lowercase slug");
  }
  return value;
}

function themesDir(projectPath: string): string {
  return join(dirname(projectPath), "themes");
}

function parseDefinition(json: string, path: string): Theme {
  try {
    return parseThemeJson(json);
  } catch (error) {
    throw new ThemeValidationError(`Invalid theme at ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

async function loadCanonicalTheme(projectPath: string, id: string): Promise<Theme> {
  const path = join(themesDir(projectPath), `${id}.json`);
  let json: string;
  try {
    json = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ThemeNotFoundError(`Theme "${id}" not found at ${path}`, { cause: error });
    }
    throw error;
  }
  const theme = parseDefinition(json, path);
  if (theme.id !== id) {
    throw new ThemeValidationError(
      `Theme file id "${theme.id}" does not match requested id "${id}"`,
    );
  }
  return theme;
}

export async function loadTheme(projectPath: string, rawId: unknown): Promise<Theme> {
  const id = themeId(rawId);
  return loadCanonicalTheme(await resolveExistingProjectPath(projectPath), id);
}

export async function listThemes(projectPath: string): Promise<Theme[]> {
  const dir = themesDir(await resolveExistingProjectPath(projectPath));
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const themes = await Promise.all(files.map(async (file) => {
    const path = join(dir, file);
    const theme = parseDefinition(await readFile(path, "utf8"), path);
    if (`${theme.id}.json` !== file) {
      throw new ThemeValidationError(`Theme file ${file} must match its id "${theme.id}"`);
    }
    return theme;
  }));
  return themes.sort((a, b) => a.id.localeCompare(b.id));
}

export async function applyThemeFile(
  projectPath: string,
  rawId: unknown,
  lockOptions: ProjectLockOptions = {},
): Promise<{
  project: Project;
  theme: Theme;
}> {
  const id = themeId(rawId);
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const theme = await loadCanonicalTheme(canonicalPath, id);
  const updated = await updateProjectFile(canonicalPath, (current) => {
    try {
      return { project: applyTheme(current, theme), value: undefined };
    } catch (error) {
      throw new ThemeApplyError((error as Error).message, { cause: error });
    }
  }, lockOptions);
  return { project: updated.project, theme };
}
