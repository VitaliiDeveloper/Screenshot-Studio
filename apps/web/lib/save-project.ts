// SPDX-License-Identifier: Apache-2.0
import type { Project } from "@screenshot-studio/core/model";

let projectRevision: string | undefined;

function isStrongQuotedETag(value: string): boolean {
  if (value.length < 3 || value[0] !== '"' || value.at(-1) !== '"') return false;
  for (const character of value.slice(1, -1)) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x20 || codePoint === 0x22 || codePoint === 0x7f) return false;
  }
  return true;
}

/** Validate and return the opaque strong ETag used by editor resource loads and saves. */
export function requireProjectRevision(revision: string | null): string {
  if (revision === null || !isStrongQuotedETag(revision)) {
    throw new Error("Project response is missing a valid strong ETag");
  }
  return revision;
}

/** Replace the editor's opaque project revision after a confirmed server response. */
export function setProjectRevision(revision: string | null): void {
  projectRevision = requireProjectRevision(revision);
}

export function getProjectRevision(): string | undefined {
  return projectRevision;
}

/** Advance the editor revision after a durable server-side project resource mutation. */
export function advanceProjectRevisionFromResponse(
  response: Pick<Response, "headers">,
): void {
  setProjectRevision(response.headers.get("etag"));
}

/** Persist the project to disk through the API route (spec §4). Throws on any rejected save. */
export async function saveProject(project: Project): Promise<void> {
  const revision = getProjectRevision();
  if (!revision) {
    throw new Error("Project revision is unavailable; reload the project before saving");
  }

  const res = await fetch("/api/project", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "if-match": revision,
    },
    body: JSON.stringify(project),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Save failed (${res.status})`);
  }
  advanceProjectRevisionFromResponse(res);
}
