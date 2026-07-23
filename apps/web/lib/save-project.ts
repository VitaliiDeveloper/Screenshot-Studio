// SPDX-License-Identifier: Apache-2.0
import type { Project } from "@screenshot-studio/core/model";
import { isStrongQuotedETag } from "./http-etag.js";

let projectRevision: string | undefined;
let projectId: string | undefined;

export interface ProjectPersistenceIdentity {
  projectId: string;
  revision: string;
}

export type ProjectAssetResolver = (path: string) => string;

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

/** Bind all client persistence to the project identity and revision returned by one GET. */
export function setProjectPersistenceIdentity(
  nextProjectId: string,
  revision: string | null,
): void {
  const normalizedProjectId = nextProjectId.trim();
  if (!normalizedProjectId) {
    throw new Error("Project response is missing its project identifier");
  }
  const validatedRevision = requireProjectRevision(revision);
  projectId = normalizedProjectId;
  projectRevision = validatedRevision;
}

export function getProjectPersistenceIdentity(): ProjectPersistenceIdentity | undefined {
  return projectId && projectRevision ? { projectId, revision: projectRevision } : undefined;
}

/** Build headers that fence a project-bound request to the editor's loaded workspace. */
export function projectRequestHeaders(options: {
  conditional?: boolean;
  headers?: HeadersInit;
} = {}): Headers {
  const identity = getProjectPersistenceIdentity();
  if (!identity) {
    throw new Error("Project identity is unavailable; reload the project before continuing");
  }
  const headers = new Headers(options.headers);
  headers.set("x-project-id", identity.projectId);
  if (options.conditional) headers.set("if-match", identity.revision);
  return headers;
}

export function clearProjectPersistenceIdentity(): void {
  projectId = undefined;
  projectRevision = undefined;
}

export function createProjectAssetResolver(
  identity: ProjectPersistenceIdentity,
): ProjectAssetResolver {
  const prefix = `/api/asset?projectId=${encodeURIComponent(identity.projectId)}`
    + `&revision=${encodeURIComponent(identity.revision)}&path=`;
  return (path) => `${prefix}${encodeURIComponent(path)}`;
}

/** Resolve an interactive asset against the currently loaded persistence identity. */
export function resolveActiveProjectAssetUrl(path: string): string {
  const identity = getProjectPersistenceIdentity();
  if (!identity) {
    throw new Error("Project identity is unavailable; reload the project before loading assets");
  }
  return createProjectAssetResolver(identity)(path);
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

/** Persist the project to disk through the API route. Throws on any rejected save. */
export async function saveProject(project: Project): Promise<void> {
  if (!getProjectRevision()) {
    throw new Error("Project revision is unavailable; reload the project before saving");
  }
  const identity = getProjectPersistenceIdentity();
  if (!identity) {
    throw new Error("Project identity is unavailable; reload the project before saving");
  }

  const res = await fetch("/api/project", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "if-match": identity.revision,
      "x-project-id": identity.projectId,
    },
    body: JSON.stringify(project),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Save failed (${res.status})`);
  }
  advanceProjectRevisionFromResponse(res);
}
