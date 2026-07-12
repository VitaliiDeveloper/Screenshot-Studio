// SPDX-License-Identifier: Apache-2.0
import {
  Project,
  type Project as ProjectModel,
} from "./schema.js";

/** Slug suitable for screen ids (lowercase, hyphenated, non-empty). */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "screen"
  );
}

/** Title-case words from an id/slug for a default display name. */
export function titleFromId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/** First free id derived from `base` among existing screens. */
export function uniqueId(base: string, screens: readonly { id: string }[]): string {
  const used = new Set(screens.map((screen) => screen.id));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Re-derive `platforms` and `locales` from screens and re-validate.
 * Call after any mutation that adds/removes screens or changes platform/locale.
 */
export function recomputeManifests(project: ProjectModel): ProjectModel {
  const platforms = Array.from(new Set(project.screens.map((screen) => screen.platform)));
  const locales = Array.from(new Set(project.screens.map((screen) => screen.locale)));
  return Project.parse({ ...project, platforms, locales });
}
