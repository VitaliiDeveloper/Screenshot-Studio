import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createScreenFromTemplate,
  parseTemplateJson,
  type ScreenTemplate,
} from "@screenshot-studio/core/templates";
import type { Project, Screen } from "@screenshot-studio/core/model";
import { loadProjectFile, writeProjectFile } from "./project-io.js";

const TEMPLATE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class TemplateValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateValidationError";
  }
}

export class TemplateNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateNotFoundError";
  }
}

export class TemplateCreateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TemplateCreateError";
  }
}

export function templateId(value: unknown): string {
  if (typeof value !== "string" || !TEMPLATE_ID.test(value)) {
    throw new TemplateValidationError("Template id must be a lowercase slug");
  }
  return value;
}

export function templateLocale(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TemplateValidationError("Template locale must be a non-empty string");
  }
  return value;
}

function templatesDir(projectPath: string): string {
  return join(dirname(projectPath), "templates");
}

function parseDefinition(json: string, path: string): ScreenTemplate {
  try {
    return parseTemplateJson(json);
  } catch (error) {
    throw new TemplateValidationError(`Invalid template at ${path}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

export async function loadTemplate(projectPath: string, rawId: unknown): Promise<ScreenTemplate> {
  const id = templateId(rawId);
  const path = join(templatesDir(projectPath), `${id}.json`);
  let json: string;
  try {
    json = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TemplateNotFoundError(`Template "${id}" not found at ${path}`, { cause: error });
    }
    throw error;
  }
  const template = parseDefinition(json, path);
  if (template.id !== id) {
    throw new TemplateValidationError(
      `Template file id "${template.id}" does not match requested id "${id}"`,
    );
  }
  return template;
}

export async function listTemplates(projectPath: string): Promise<ScreenTemplate[]> {
  const dir = templatesDir(projectPath);
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
  const templates = await Promise.all(files.map(async (file) => {
    const path = join(dir, file);
    const template = parseDefinition(await readFile(path, "utf8"), path);
    if (`${template.id}.json` !== file) {
      throw new TemplateValidationError(`Template file ${file} must match its id "${template.id}"`);
    }
    return template;
  }));
  return templates.sort((a, b) => a.id.localeCompare(b.id));
}

export async function createTemplateScreen(
  projectPath: string,
  rawId: unknown,
  rawLocale: unknown,
): Promise<{ project: Project; screen: Screen; template: ScreenTemplate }> {
  const template = await loadTemplate(projectPath, rawId);
  const locale = templateLocale(rawLocale);
  const current = await loadProjectFile(projectPath);
  let result: { project: Project; screen: Screen };
  try {
    result = createScreenFromTemplate(current, template, locale);
  } catch (error) {
    throw new TemplateCreateError((error as Error).message, { cause: error });
  }
  await writeProjectFile(projectPath, result.project);
  return { ...result, template };
}
