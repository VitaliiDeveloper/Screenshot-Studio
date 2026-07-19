// SPDX-License-Identifier: Apache-2.0

const OPERATION_ID_PATTERN = /^operation_[0-9a-f]{32}$/;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const REVISION_PATTERN = /^[0-9a-f]{64}$/;

export type ProjectDeletionStatus =
  | "in-progress"
  | "deleted-cleanup-pending"
  | "deleted-complete";

export type ProjectDeletionResult =
  | { operationId: string; status: ProjectDeletionStatus }
  | { status: "expired-or-unknown" };

export interface ProjectDeletionCredentials {
  operationId: string;
  statusSecret: string;
}

export interface ProjectDeletionRequest extends ProjectDeletionCredentials {
  projectId: string;
  projectRevision: string;
  lifecycleRevision: number;
  confirmation: string;
  backup:
    | { kind: "none"; acknowledged: true }
    | { kind: "archive"; projectRevision: string };
}

export type ProjectDeletionFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

function validateCredentials(input: ProjectDeletionCredentials): void {
  if (!OPERATION_ID_PATTERN.test(input.operationId) || !SECRET_PATTERN.test(input.statusSecret)) {
    throw new TypeError("Invalid project deletion credentials");
  }
}

function parseResult(
  value: unknown,
  operationId: string,
  allowUnknown: boolean,
): ProjectDeletionResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Project deletion returned an invalid response");
  }
  const body = value as Record<string, unknown>;
  if (allowUnknown && body.status === "expired-or-unknown" && Object.keys(body).length === 1) {
    return { status: "expired-or-unknown" };
  }
  if (body.operationId !== operationId
    || !["in-progress", "deleted-cleanup-pending", "deleted-complete"].includes(String(body.status))
    || Object.keys(body).length !== 2) {
    throw new Error("Project deletion returned an invalid response");
  }
  return { operationId, status: body.status as ProjectDeletionStatus };
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export async function requestProjectDeletion(
  input: ProjectDeletionRequest,
  fetcher: ProjectDeletionFetcher = fetch,
): Promise<Exclude<ProjectDeletionResult, { status: "expired-or-unknown" }>> {
  validateCredentials(input);
  if (!REVISION_PATTERN.test(input.projectRevision)
    || !Number.isSafeInteger(input.lifecycleRevision) || input.lifecycleRevision <= 0) {
    throw new TypeError("Invalid project deletion request");
  }
  const response = await fetcher("/api/project-delete", {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "if-match": `"${input.projectRevision}"`,
      "x-project-id": input.projectId,
    },
    body: JSON.stringify({
      operationId: input.operationId,
      statusSecret: input.statusSecret,
      expectedLifecycleRevision: input.lifecycleRevision,
      confirmation: input.confirmation,
      backup: input.backup,
    }),
  });
  const body = await responseBody(response);
  if (!response.ok) {
    throw new Error(typeof body.error === "string"
      ? body.error
      : `Permanent deletion failed (${response.status})`);
  }
  return parseResult(body, input.operationId, false) as Exclude<
    ProjectDeletionResult,
    { status: "expired-or-unknown" }
  >;
}

export async function requestProjectDeletionStatus(
  credentials: ProjectDeletionCredentials,
  fetcher: ProjectDeletionFetcher = fetch,
): Promise<ProjectDeletionResult> {
  validateCredentials(credentials);
  const response = await fetcher("/api/project-delete/operation", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const body = await responseBody(response);
  if (response.status === 404) return parseResult(body, credentials.operationId, true);
  if (!response.ok) {
    throw new Error(typeof body.error === "string"
      ? body.error
      : `Deletion status failed (${response.status})`);
  }
  return parseResult(body, credentials.operationId, false);
}
