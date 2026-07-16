// SPDX-License-Identifier: Apache-2.0
const ARTIFACT_PATH = /^\/api\/export\/artifacts\/[A-Za-z0-9_-]{43}$/;
const DOWNLOAD_FILENAME = "app-store-screenshots-bundle.zip";

export interface ExportArtifactTicket {
  downloadUrl: string;
  outputDir: string;
  expiresAt: string;
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
    || typeof candidate.outputDir !== "string"
    || candidate.outputDir.trim().length === 0
    || typeof candidate.expiresAt !== "string"
    || !Number.isFinite(Date.parse(candidate.expiresAt))) {
    throw new Error("Invalid export artifact ticket");
  }
  return {
    downloadUrl: candidate.downloadUrl,
    outputDir: candidate.outputDir,
    expiresAt: candidate.expiresAt,
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
  anchor.download = DOWNLOAD_FILENAME;
  environment.appendAnchor(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
  return { ...ticket, downloadUrl: href };
}
