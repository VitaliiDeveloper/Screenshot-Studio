// SPDX-License-Identifier: Apache-2.0
import { readJsonBody, readJsonResponse, responseErrorMessage } from "./json-response.js";

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

export type ProjectDeletionRetryResult =
  | {
    kind: "accepted";
    result: Exclude<ProjectDeletionResult, { status: "expired-or-unknown" }>;
  }
  | { kind: "unknown-after-admission" };

export interface ProjectDeletionCredentials {
  operationId: string;
  statusSecret: string;
}

export type ProjectDeletionRandomBytes = (length: number) => Uint8Array;

export interface ProjectDeletionRequest extends ProjectDeletionCredentials {
  projectId: string;
  projectRevision: string;
  lifecycleRevision: number;
  confirmation: string;
  backup:
    | { kind: "none"; acknowledged: true }
    | { kind: "archive"; projectRevision: string };
}

export interface ProjectDeletionAttempt {
  request: ProjectDeletionRequest;
  admitted: boolean;
}

export type ProjectDeletionAttemptResult =
  | { kind: "verified" }
  | { kind: "unknown-after-admission" };

export type ProjectDeletionFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

function validateCredentials(input: ProjectDeletionCredentials): void {
  if (!OPERATION_ID_PATTERN.test(input.operationId) || !SECRET_PATTERN.test(input.statusSecret)) {
    throw new TypeError("Invalid project deletion credentials");
  }
}

function secureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createProjectDeletionCredentials(
  randomBytes: ProjectDeletionRandomBytes = secureRandomBytes,
): ProjectDeletionCredentials {
  const operationBytes = randomBytes(16);
  const secretBytes = randomBytes(32);
  if (operationBytes.byteLength !== 16 || secretBytes.byteLength !== 32) {
    throw new TypeError("Project deletion credential generator returned invalid bytes");
  }
  return {
    operationId: `operation_${hex(operationBytes)}`,
    statusSecret: hex(secretBytes),
  };
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
  const body = await readJsonResponse(response, `Permanent deletion failed (${response.status})`);
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
  const body = await readJsonBody(response);
  if (response.status === 404) return parseResult(body, credentials.operationId, true);
  if (!response.ok) {
    throw new Error(responseErrorMessage(body, `Deletion status failed (${response.status})`));
  }
  return parseResult(body, credentials.operationId, false);
}

export async function retryProjectDeletion(
  input: ProjectDeletionRequest,
  admitted: boolean,
  fetcher: ProjectDeletionFetcher = fetch,
): Promise<ProjectDeletionRetryResult> {
  const recovered = await requestProjectDeletionStatus(input, fetcher);
  if (recovered.status !== "expired-or-unknown") {
    return { kind: "accepted", result: recovered };
  }
  if (admitted) return { kind: "unknown-after-admission" };
  return {
    kind: "accepted",
    result: await requestProjectDeletion(input, fetcher),
  };
}

export async function settleProjectDeletion(
  credentials: ProjectDeletionCredentials,
  initial: Exclude<ProjectDeletionResult, { status: "expired-or-unknown" }>,
  dependencies: {
    fetcher?: ProjectDeletionFetcher;
    wait?: (milliseconds: number) => Promise<void>;
    maxAttempts?: number;
  } = {},
): Promise<Exclude<ProjectDeletionResult, { status: "expired-or-unknown" | "in-progress" }>> {
  if (initial.status !== "in-progress") return initial;
  const maxAttempts = dependencies.maxAttempts ?? 12;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0 || maxAttempts > 60) {
    throw new TypeError("Invalid project deletion status attempt limit");
  }
  const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await wait(250);
    const result = await requestProjectDeletionStatus(credentials, dependencies.fetcher);
    if (result.status === "expired-or-unknown") {
      throw new Error("Permanent deletion could not be verified; reload App Home before trying again");
    }
    if (result.status !== "in-progress") return result;
  }
  throw new Error("Permanent deletion is still in progress; retry its status shortly");
}

export async function advanceProjectDeletionAttempt(
  attempt: ProjectDeletionAttempt,
  recovering: boolean,
  dependencies: {
    fetcher?: ProjectDeletionFetcher;
    wait?: (milliseconds: number) => Promise<void>;
    maxAttempts?: number;
  } = {},
): Promise<ProjectDeletionAttemptResult> {
  let initial: Exclude<ProjectDeletionResult, { status: "expired-or-unknown" }>;
  if (recovering) {
    const recovered = await retryProjectDeletion(
      attempt.request,
      attempt.admitted,
      dependencies.fetcher,
    );
    if (recovered.kind === "unknown-after-admission") return recovered;
    initial = recovered.result;
  } else {
    initial = await requestProjectDeletion(attempt.request, dependencies.fetcher);
  }
  attempt.admitted = true;
  await settleProjectDeletion(attempt.request, initial, dependencies);
  return { kind: "verified" };
}
