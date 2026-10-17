// SPDX-License-Identifier: Apache-2.0
import type { DesignLayout, Project } from "@screenshot-studio/core/model";
import { buildBundleEntries, type StoreSpecs } from "@screenshot-studio/core/export";

const ARTIFACT_PATH = /^\/api\/export\/artifacts\/[A-Za-z0-9_-]{43}$/;
const DOWNLOAD_FILENAMES = new Set([
  "app-store-screenshots-bundle.zip",
  "web-share-package.zip",
]);

export interface ExportFilters {
  platform: string;
  device: string;
  locale: string;
}

export const DEFAULT_EXPORT_FILTERS: ExportFilters = {
  platform: "all",
  device: "all",
  locale: "all",
};

export function normalizeExportFilters(
  layout: DesignLayout,
  filters: ExportFilters,
): ExportFilters {
  const platforms = new Set<string>(layout.screens.map((screen) => screen.platform));
  const platform = filters.platform === "all" || platforms.has(filters.platform)
    ? filters.platform
    : "all";
  const devices = new Set<string>(layout.screens
    .filter((screen) => platform === "all" || screen.platform === platform)
    .map((screen) => screen.device));
  const device = filters.device === "all" || devices.has(filters.device)
    ? filters.device
    : "all";
  const locales = new Set<string>(layout.screens
    .filter((screen) => platform === "all" || screen.platform === platform)
    .filter((screen) => device === "all" || screen.device === device)
    .map((screen) => screen.locale));
  const locale = filters.locale === "all" || locales.has(filters.locale)
    ? filters.locale
    : "all";
  return { platform, device, locale };
}

/**
 * Files a store-bundle export writes with the dialog's default filters, built by the same
 * function `/api/export` uses. Null when there is no layout or the bundle cannot be built.
 */
export function exportFileCount(
  project: Project | null,
  layoutId: string | null,
  specs: StoreSpecs,
): number | null {
  if (!project || !layoutId) return null;
  try {
    return buildBundleEntries(project, layoutId, specs).length;
  } catch {
    return null;
  }
}

export function exportButtonLabel(fileCount: number | null): string {
  return fileCount === null ? "Export" : `Export, ${fileCount} ${fileCount === 1 ? "file" : "files"}`;
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
