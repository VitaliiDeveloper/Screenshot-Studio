// SPDX-License-Identifier: Apache-2.0
import { Project, type Project as ProjectType } from "./schema.js";

export * from "./schema.js";
export * from "./device-frames.js";
export * from "./font-identity.js";
export * from "./factories.js";
export * from "./project-ops.js";
export * from "./connected-canvas.js";
export * from "./element-tree.js";
export * from "./group-ops.js";
export * from "./icons.js";
export * from "./badge-primitives.js";
export * from "./assert-never.js";

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
 * Strictly validate a raw project object into a typed `Project`.
 * The single load path for both UI and CLI — invalid input throws loudly (editor.md §7),
 * never returns a partially-valid project.
 */
export function parseProject(raw: unknown): ProjectType {
  const meta = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>).meta
    : undefined;
  const schemaVersion = meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>).schemaVersion
    : undefined;
  if (typeof schemaVersion === "number" && Number.isFinite(schemaVersion) && schemaVersion !== 1) {
    const message = `Unsupported project schema version ${schemaVersion}. This build accepts version 1 only.`;
    throw new ProjectValidationError(message, "");
  }

  const result = Project.safeParse(raw);
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
