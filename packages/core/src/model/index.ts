// SPDX-License-Identifier: Apache-2.0
import { Project, type Project as ProjectType } from "./schema.js";
import { migrateToCurrent } from "./migrate.js";

export * from "./schema.js";
export * from "./device-frames.js";
export * from "./font-identity.js";
export * from "./factories.js";
export * from "./project-ops.js";
export * from "./connected-canvas.js";
export * from "./assert-never.js";
export { migrateToCurrent } from "./migrate.js";

/** Raised when a project fails schema validation. Carries the human-readable validator report. */
export class ProjectValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string,
  ) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

/**
 * Parse + migrate + strictly validate a raw project object into a typed `Project`.
 * The single load path for both UI and CLI — invalid input throws loudly (editor.md §7),
 * never returns a partially-valid project.
 */
export function parseProject(raw: unknown): ProjectType {
  const migrated = migrateToCurrent(raw);
  const result = Project.safeParse(migrated);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ProjectValidationError(`Invalid project JSON:\n${issues}`, issues);
  }
  return result.data;
}

/** Parse a JSON string into a validated `Project`. */
export function parseProjectJson(json: string): ProjectType {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new ProjectValidationError(
      `Project file is not valid JSON: ${(err as Error).message}`,
      "",
    );
  }
  return parseProject(raw);
}

/** Look up a screen by id, or throw with a clear message. */
export function getScreen(project: ProjectType, screenId: string) {
  const screen = project.screens.find((s) => s.id === screenId);
  if (!screen) {
    const known = project.screens.map((s) => s.id).join(", ");
    throw new Error(`Screen "${screenId}" not found. Known screens: ${known}`);
  }
  return screen;
}
