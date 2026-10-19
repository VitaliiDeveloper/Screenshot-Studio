// SPDX-License-Identifier: Apache-2.0
import type { BundleEntry } from "@screenshot-studio/core/export";

const MAX_SELECTION_VALUES = 512;
const MAX_SELECTION_VALUE_LENGTH = 256;

/** Exact sizes and locales the Export dialog checked; an omitted list keeps every value. */
export interface ExportSelection {
  sizes?: readonly string[];
  locales?: readonly string[];
}

/** A file the export could not render; the rest of the bundle is still written. */
export interface ExportFileFailure {
  screenId: string;
  relativePath: string;
  message: string;
}

/** One exact store size: the destination family plus its store-specs target id. */
export function exportSizeKey(entry: Pick<BundleEntry, "screen" | "target">): string {
  return `${entry.screen.platform}/${entry.screen.device}/${entry.target.id}`;
}

/**
 * The files a selection exports. Filtering the full build keeps every file's path, because a
 * path's sequence number counts only within its own locale and size.
 */
export function selectExportEntries(entries: readonly BundleEntry[], selection: ExportSelection): BundleEntry[] {
  const sizes = selection.sizes && new Set(selection.sizes);
  const locales = selection.locales && new Set(selection.locales);
  return entries.filter((entry) => (!sizes || sizes.has(exportSizeKey(entry)))
    && (!locales || locales.has(entry.screen.locale)));
}

function parseValues(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)
    || value.length > MAX_SELECTION_VALUES
    || !value.every((item) => typeof item === "string" && item.length <= MAX_SELECTION_VALUE_LENGTH)) {
    throw new Error(`Export ${field} must be a list of names`);
  }
  return value;
}

export function parseExportSelection(body: { sizes?: unknown; locales?: unknown }): ExportSelection {
  return { sizes: parseValues(body.sizes, "sizes"), locales: parseValues(body.locales, "locales") };
}
