// SPDX-License-Identifier: Apache-2.0
import type { Project } from "@screenshot-studio/core/model";
import {
  buildBundleEntries,
  destinationLabel,
  type BundleEntry,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { conciseStoreTargetLabel, outputFamilyEditorLabel } from "@web/lib/editor/editor-workspace";
import { exportSizeKey, selectExportEntries, type ExportFileFailure } from "@web/lib/export-selection";

const ARTIFACT_PATH = /^\/api\/export\/artifacts\/[A-Za-z0-9_-]{43}$/;
const DOWNLOAD_FILENAMES = new Set([
  "app-store-screenshots-bundle.zip",
  "web-share-package.zip",
]);

export interface ExportSizeRow {
  key: string;
  label: string;
  width: number;
  height: number;
  /** Files this size writes for the checked locales. */
  files: number;
  blockers: number;
  warnings: number;
}

export interface ExportLocaleRow {
  locale: string;
  /** Files this locale writes for the checked sizes. */
  files: number;
  missingScreens: number;
}

export interface ExportChecks {
  sizes: ReadonlySet<string>;
  locales: ReadonlySet<string>;
}

/** Every file of the layout in export order, or why the bundle cannot be built. */
export function layoutExportEntries(
  project: Project,
  layoutId: string,
  specs: StoreSpecs,
): { entries: BundleEntry[] } | { error: string } {
  try {
    return { entries: buildBundleEntries(project, layoutId, specs) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The dialog's default: every size and locale the layout exports, matching the toolbar count. */
export function allExportChecks(entries: readonly BundleEntry[]): ExportChecks {
  return {
    sizes: new Set(entries.map(exportSizeKey)),
    locales: new Set(entries.map((entry) => entry.screen.locale)),
  };
}

export function checkedExportEntries(entries: readonly BundleEntry[], checks: ExportChecks): BundleEntry[] {
  return selectExportEntries(entries, { sizes: [...checks.sizes], locales: [...checks.locales] });
}

/**
 * Issues that concern the checked files: a screen issue when its screen is exported, a missing
 * locale screen when that locale and the source screen's size (any size of its family when the
 * copy spans every size) are checked. Unchecking a locale or size therefore lifts its blockers.
 */
export function exportScopeIssues(
  entries: readonly BundleEntry[],
  checks: ExportChecks,
  issues: readonly ProjectIssue[],
): ProjectIssue[] {
  const exported = new Set(checkedExportEntries(entries, checks).map((entry) => entry.screen.id));
  const sizeByScreen = new Map(entries.map((entry) => [entry.screen.id, entry]));
  return issues.filter((issue) => {
    if (issue.kind !== "missing-locale-screen") return exported.has(issue.screenId);
    const source = sizeByScreen.get(issue.sourceScreenId);
    if (!source || !checks.locales.has(issue.locale)) return false;
    const family = `${source.screen.platform}/${source.screen.device}/`;
    return issue.allSizes
      ? [...checks.sizes].some((key) => key.startsWith(family))
      : checks.sizes.has(exportSizeKey(source));
  });
}

/** One row per exact size, with its store-specs pixels and the checked files and issues it holds. */
export function exportSizeRows(
  entries: readonly BundleEntry[],
  checks: ExportChecks,
  scopedIssues: readonly ProjectIssue[],
  specs: StoreSpecs,
): ExportSizeRow[] {
  const rows = new Map<string, ExportSizeRow>();
  const rowByScreen = new Map<string, ExportSizeRow>();
  for (const entry of entries) {
    const key = exportSizeKey(entry);
    const { platform, device } = entry.screen;
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        label: `${destinationLabel(platform, specs)} · ${outputFamilyEditorLabel(platform, device, specs)} `
          + conciseStoreTargetLabel(entry.target, platform, device, specs),
        width: entry.target.width,
        height: entry.target.height,
        files: 0,
        blockers: 0,
        warnings: 0,
      };
      rows.set(key, row);
    }
    rowByScreen.set(entry.screen.id, row);
    if (checks.locales.has(entry.screen.locale)) row.files += 1;
  }
  for (const issue of scopedIssues) {
    if (issue.kind === "missing-locale-screen") continue;
    const row = rowByScreen.get(issue.screenId);
    if (row && issue.level === "blocker") row.blockers += 1;
    else if (row) row.warnings += 1;
  }
  return [...rows.values()];
}

export function exportLocaleRows(
  entries: readonly BundleEntry[],
  checks: ExportChecks,
  issues: readonly ProjectIssue[],
): ExportLocaleRow[] {
  const rows = new Map<string, ExportLocaleRow>();
  for (const entry of entries) {
    const row = rows.get(entry.screen.locale) ?? { locale: entry.screen.locale, files: 0, missingScreens: 0 };
    if (checks.sizes.has(exportSizeKey(entry))) row.files += 1;
    rows.set(entry.screen.locale, row);
  }
  for (const issue of issues) {
    const row = issue.kind === "missing-locale-screen" ? rows.get(issue.locale) : undefined;
    if (row) row.missingScreens += 1;
  }
  return [...rows.values()];
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Real bundle paths for the preview: the first file of each checked size and locale. */
export function exportPathPreview(checked: readonly BundleEntry[], limit = 3): string[] {
  const groups = new Set<string>();
  return checked.filter((entry) => {
    const group = `${exportSizeKey(entry)}\u0000${entry.screen.locale}`;
    if (groups.has(group)) return false;
    groups.add(group);
    return true;
  }).slice(0, limit).map((entry) => entry.relativePath);
}

/** "30 files · 4 sizes × 2 locales", counting only sizes and locales that write a file. */
export function exportSelectionSummary(checked: readonly BundleEntry[]): string {
  const sizes = new Set(checked.map(exportSizeKey)).size;
  const locales = new Set(checked.map((entry) => entry.screen.locale)).size;
  return `${plural(checked.length, "file")} · ${plural(sizes, "size")} × ${plural(locales, "locale")}`;
}

/**
 * Files a store-bundle export writes with the dialog's default checks, built by the same
 * function `/api/export` uses. Null when there is no layout or the bundle cannot be built.
 */
export function exportFileCount(
  project: Project | null,
  layoutId: string | null,
  specs: StoreSpecs,
): number | null {
  if (!project || !layoutId) return null;
  const built = layoutExportEntries(project, layoutId, specs);
  return "entries" in built ? built.entries.length : null;
}

export function exportButtonLabel(fileCount: number | null): string {
  return fileCount === null ? "Export" : `Export, ${fileCount} ${fileCount === 1 ? "file" : "files"}`;
}

export interface ExportOutcome {
  written: number;
  total: number;
  stopped: boolean;
  failures: ExportFileFailure[];
}

export function parseExportFailures(raw: unknown): ExportFileFailure[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ExportFileFailure => typeof item === "object" && item !== null
    && typeof item.screenId === "string"
    && typeof item.relativePath === "string"
    && typeof item.message === "string");
}

/** The written/failed/stopped counts of a finished export; a body without them reads as complete. */
export function parseExportOutcome(body: Record<string, unknown>, requested: number): ExportOutcome {
  const count = (value: unknown, fallback: number) => (Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : fallback);
  const total = count(body.total, requested);
  return {
    written: Math.min(count(body.written, total), total),
    total,
    stopped: body.stopped === true,
    failures: parseExportFailures(body.failures),
  };
}

export interface ExportArtifactTicket {
  downloadUrl: string;
  expiresAt: string;
  filename: string;
}

export interface ExportDownloadAnchor {
  href: string;
  download: string;
  click(): void;
  remove(): void;
}

export interface ExportDownloadEnvironment {
  origin: string;
  createAnchor(): ExportDownloadAnchor;
  appendAnchor(anchor: ExportDownloadAnchor): void;
}

function parseTicket(raw: unknown): ExportArtifactTicket {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid export artifact ticket");
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.downloadUrl !== "string"
    || typeof candidate.expiresAt !== "string"
    || !Number.isFinite(Date.parse(candidate.expiresAt))
    || typeof candidate.filename !== "string"
    || !DOWNLOAD_FILENAMES.has(candidate.filename)) {
    throw new Error("Invalid export artifact ticket");
  }
  return {
    downloadUrl: candidate.downloadUrl,
    expiresAt: candidate.expiresAt,
    filename: candidate.filename,
  };
}

function validateDownloadUrl(downloadUrl: string, currentOrigin: string): string {
  let expectedOrigin: string;
  let resolved: URL;
  try {
    expectedOrigin = new URL(currentOrigin).origin;
    resolved = new URL(downloadUrl, expectedOrigin);
  } catch (error) {
    throw new Error("Invalid export artifact download URL", { cause: error });
  }
  if (resolved.origin !== expectedOrigin
    || resolved.username !== ""
    || resolved.password !== ""
    || resolved.search !== ""
    || resolved.hash !== ""
    || !ARTIFACT_PATH.test(resolved.pathname)) {
    throw new Error("Invalid export artifact download URL");
  }
  return resolved.href;
}

export function launchExportArtifactDownload(
  rawTicket: unknown,
  environment: ExportDownloadEnvironment,
): ExportArtifactTicket {
  const ticket = parseTicket(rawTicket);
  const href = validateDownloadUrl(ticket.downloadUrl, environment.origin);
  const anchor = environment.createAnchor();
  anchor.href = href;
  anchor.download = ticket.filename;
  environment.appendAnchor(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
  return { ...ticket, downloadUrl: href };
}
