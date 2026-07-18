// SPDX-License-Identifier: Apache-2.0

const ARCHIVE_URL_PATTERN = /^\/api\/project-archive\/artifacts\/[A-Za-z0-9_-]{43}$/;
const ARCHIVE_FILENAME = "screenshot-studio-project.zip";

export interface ProjectArchiveTicket {
  downloadUrl: string;
  expiresAt: string;
  filename: typeof ARCHIVE_FILENAME;
}

export type ProjectArchiveFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface ArchiveDownloadDocument {
  createElement(tag: "a"): HTMLAnchorElement;
  body: Pick<HTMLElement, "appendChild">;
}

export async function requestProjectArchive(
  projectId: string,
  fetcher: ProjectArchiveFetcher = fetch,
): Promise<ProjectArchiveTicket> {
  const response = await fetcher("/api/project-archive", {
    method: "POST",
    cache: "no-store",
    headers: { "x-project-id": projectId },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === "string"
      ? body.error
      : `Project archive export failed (${response.status})`);
  }
  if (typeof body.downloadUrl !== "string" || !ARCHIVE_URL_PATTERN.test(body.downloadUrl)
    || body.filename !== ARCHIVE_FILENAME || typeof body.expiresAt !== "string"
    || Number.isNaN(Date.parse(body.expiresAt))) {
    throw new Error("Project archive export returned an invalid ticket");
  }
  return {
    downloadUrl: body.downloadUrl,
    expiresAt: body.expiresAt,
    filename: ARCHIVE_FILENAME,
  };
}

export function downloadProjectArchive(
  ticket: ProjectArchiveTicket,
  documentLike: ArchiveDownloadDocument = document,
): void {
  const anchor = documentLike.createElement("a");
  anchor.href = ticket.downloadUrl;
  anchor.download = ticket.filename;
  anchor.rel = "noopener";
  documentLike.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
