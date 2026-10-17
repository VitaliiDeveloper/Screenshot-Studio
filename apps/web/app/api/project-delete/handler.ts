// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import type { ManagedProjectDeletionEvidence } from "@web/lib/managed-project-catalog.server.js";
import {
  resolveManagedProjectStorageConfig,
  type ManagedProjectStorageConfig,
} from "@web/lib/managed-project-config.server.js";
import {
  ManagedProjectLifecycleService,
  type PermanentlyDeleteManagedProjectInput,
  type ReconcileManagedProjectDeletionInput,
} from "@web/lib/managed-project-lifecycle.server.js";
import type { ManagedProjectLifecycleLock } from "@web/lib/managed-project-lifecycle-lock.server.js";
import {
  withProjectVersionedReadRequest,
  type ProjectReadRequestDependencies,
} from "@web/lib/project-request-fence.server.js";
import {
  projectSessionRegistry,
  type ProjectSessionRegistry,
} from "@web/lib/project-session.server.js";
import { expiredProjectSessionResponseHeaders } from "@web/app/api/project-session/handler.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

const MAX_DELETE_REQUEST_BYTES = 2_048;
const OPERATION_ID_PATTERN = /^operation_[0-9a-f]{32}$/;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const REVISION_PATTERN = /^[0-9a-f]{64}$/;
const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i;

interface DeleteLifecycleService {
  permanentlyDelete(
    input: PermanentlyDeleteManagedProjectInput,
    lifecycleLock?: ManagedProjectLifecycleLock,
  ): Promise<ManagedProjectDeletionEvidence>;
  reconcileDeletionOperation(
    input: ReconcileManagedProjectDeletionInput,
    lifecycleLock?: ManagedProjectLifecycleLock,
  ): Promise<ManagedProjectDeletionEvidence | undefined>;
}

export interface ProjectDeleteRouteDependencies {
  lifecycle?: DeleteLifecycleService;
  registry?: ProjectSessionRegistry;
  managedStorageConfig?: ManagedProjectStorageConfig;
  managedReadGuard?: ProjectReadRequestDependencies["managedReadGuard"];
}

export interface ProjectDeleteOperationRouteDependencies {
  lifecycle?: Pick<DeleteLifecycleService, "reconcileDeletionOperation">;
  registry?: ProjectSessionRegistry;
  managedStorageConfig?: ManagedProjectStorageConfig;
}

class RequestLimitError extends Error {}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new TypeError("Request body is missing");
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) throw new TypeError("Invalid content length");
    if (length > MAX_DELETE_REQUEST_BYTES) {
      await request.body.cancel().catch(() => undefined);
      throw new RequestLimitError();
    }
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DELETE_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new RequestLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function statusSecretHash(secret: string): string {
  return createHash("sha256").update(secret, "ascii").digest("hex");
}

function parseOperationCredentials(value: unknown): { operationId: string; statusSecret: string } {
  if (!isRecord(value) || !exactKeys(value, ["operationId", "statusSecret"])
    || typeof value.operationId !== "string" || !OPERATION_ID_PATTERN.test(value.operationId)
    || typeof value.statusSecret !== "string" || !SECRET_PATTERN.test(value.statusSecret)) {
    throw new TypeError("Invalid deletion operation credentials");
  }
  return { operationId: value.operationId, statusSecret: value.statusSecret };
}

interface ParsedDeleteRequest {
  operationId: string;
  statusSecret: string;
  expectedLifecycleRevision: number;
  confirmation: string;
  backup: { kind: "none" } | { kind: "archive"; projectRevision: string };
}

function parseDeleteRequest(value: unknown): ParsedDeleteRequest {
  if (!isRecord(value) || !exactKeys(value, [
    "operationId", "statusSecret", "expectedLifecycleRevision", "confirmation", "backup",
  ])) throw new TypeError("Invalid permanent deletion fields");
  const credentials = parseOperationCredentials({
    operationId: value.operationId,
    statusSecret: value.statusSecret,
  });
  if (!Number.isSafeInteger(value.expectedLifecycleRevision)
    || (value.expectedLifecycleRevision as number) <= 0
    || typeof value.confirmation !== "string" || value.confirmation.length > 1_024
    || !isRecord(value.backup)) {
    throw new TypeError("Invalid permanent deletion fields");
  }
  let backup: ParsedDeleteRequest["backup"];
  if (value.backup.kind === "none" && exactKeys(value.backup, ["kind", "acknowledged"])
    && value.backup.acknowledged === true) {
    backup = { kind: "none" };
  } else if (value.backup.kind === "archive"
    && exactKeys(value.backup, ["kind", "projectRevision"])
    && typeof value.backup.projectRevision === "string"
    && REVISION_PATTERN.test(value.backup.projectRevision)) {
    backup = { kind: "archive", projectRevision: value.backup.projectRevision };
  } else {
    throw new TypeError("Invalid permanent deletion backup decision");
  }
  return {
    ...credentials,
    expectedLifecycleRevision: value.expectedLifecycleRevision as number,
    confirmation: value.confirmation,
    backup,
  };
}

function publicStatus(evidence: ManagedProjectDeletionEvidence):
  "in-progress" | "deleted-cleanup-pending" | "deleted-complete" {
  if (evidence.state === "reserved") return "in-progress";
  if (evidence.state === "cleanup-pending") return "deleted-cleanup-pending";
  return "deleted-complete";
}

function acceptedDeletionResponse(
  request: Request,
  operationId: string,
  evidence: ManagedProjectDeletionEvidence,
): Response {
  return Response.json({
    operationId,
    status: publicStatus(evidence),
  }, {
    status: evidence.state === "complete" ? 200 : 202,
    headers: expiredProjectSessionResponseHeaders(request),
  });
}

function deletionFailureResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  if (/project revision/i.test(message)) {
    return jsonError(
      412,
      "Project changed before permanent deletion; reload and confirm again",
      "project-revision-changed",
    );
  }
  if (/lifecycle|active|conflicting|intent|admission/i.test(message)) {
    return jsonError(409, "Permanent deletion could not start; reload and try again", "deletion-rejected");
  }
  return jsonError(500, "Permanent deletion failed", "internal");
}

function resolvedDependencies(dependencies: ProjectDeleteRouteDependencies) {
  const config = dependencies.managedStorageConfig ?? resolveManagedProjectStorageConfig();
  const registry = dependencies.registry ?? projectSessionRegistry;
  return {
    config,
    registry,
    lifecycle: dependencies.lifecycle ?? new ManagedProjectLifecycleService(config, registry),
  };
}

async function parseRequest(request: Request): Promise<unknown | Response> {
  if (new URL(request.url).search.length > 0) {
    return jsonError(400, "Deletion credentials are accepted only in the request body", "invalid-request");
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
    return jsonError(415, "Permanent deletion requires JSON", "unsupported-media-type");
  }
  try {
    return await readBoundedJson(request);
  } catch (error) {
    return error instanceof RequestLimitError
      ? jsonError(413, "Permanent deletion request exceeds the byte limit", "limit")
      : jsonError(400, "Permanent deletion request is not valid JSON", "invalid-request");
  }
}

export async function handleProjectDeletePost(
  request: Request,
  dependencies: ProjectDeleteRouteDependencies = {},
): Promise<Response> {
  const raw = await parseRequest(request);
  if (raw instanceof Response) return raw;
  let parsed: ParsedDeleteRequest;
  try {
    parsed = parseDeleteRequest(raw);
  } catch {
    return jsonError(400, "Permanent deletion fields are invalid", "invalid-request");
  }
  const resolved = resolvedDependencies(dependencies);
  const response = await withProjectVersionedReadRequest(
    request,
    async (session, expectedRevision, lifecycleLock) => {
      if (session.descriptor.sourceKind !== "managed-project"
        || !session.descriptor.capabilities.deleteProjectPermanently) {
        return jsonError(409, "Permanent deletion is available only for managed projects", "managed-project-required");
      }
      if (session.descriptor.lifecycleRevision !== parsed.expectedLifecycleRevision) {
        return jsonError(409, "Project lifecycle changed; reload before deleting", "lifecycle-changed");
      }
      if (parsed.confirmation !== session.descriptor.name) {
        return jsonError(400, "Project name confirmation does not match", "confirmation-mismatch");
      }
      if (parsed.backup.kind === "archive" && parsed.backup.projectRevision !== expectedRevision) {
        return jsonError(412, "Project changed after archive export; create a new archive", "archive-stale");
      }
      const hashedSecret = statusSecretHash(parsed.statusSecret);
      const deletionInput = {
        id: session.projectId,
        expectedLifecycleRevision: parsed.expectedLifecycleRevision,
        expectedProjectRevision: expectedRevision,
        operationId: parsed.operationId,
        statusSecretHash: hashedSecret,
      };
      try {
        const evidence = await resolved.lifecycle.permanentlyDelete(deletionInput, lifecycleLock);
        return acceptedDeletionResponse(request, parsed.operationId, evidence);
      } catch (error) {
        let evidence: ManagedProjectDeletionEvidence | undefined;
        try {
          evidence = await resolved.lifecycle.reconcileDeletionOperation({
            operationId: parsed.operationId,
            statusSecretHash: hashedSecret,
          }, lifecycleLock);
        } catch {
          return jsonError(500, "Permanent deletion status is temporarily unavailable", "internal");
        }
        if (evidence) {
          return acceptedDeletionResponse(request, parsed.operationId, evidence);
        }
        return deletionFailureResponse(error);
      }
    },
    {
      registry: resolved.registry,
      managedStorageConfig: resolved.config,
      managedReadGuard: dependencies.managedReadGuard,
    },
  );
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function handleProjectDeleteOperationPost(
  request: Request,
  dependencies: ProjectDeleteOperationRouteDependencies = {},
): Promise<Response> {
  const raw = await parseRequest(request);
  if (raw instanceof Response) return raw;
  let credentials: ReturnType<typeof parseOperationCredentials>;
  try {
    credentials = parseOperationCredentials(raw);
  } catch {
    return jsonError(400, "Deletion operation credentials are invalid", "invalid-request");
  }
  const config = dependencies.managedStorageConfig ?? resolveManagedProjectStorageConfig();
  const lifecycle = dependencies.lifecycle ?? new ManagedProjectLifecycleService(
    config,
    dependencies.registry ?? projectSessionRegistry,
  );
  let evidence: ManagedProjectDeletionEvidence | undefined;
  try {
    evidence = await lifecycle.reconcileDeletionOperation({
      operationId: credentials.operationId,
      statusSecretHash: statusSecretHash(credentials.statusSecret),
    });
  } catch {
    return jsonError(500, "Deletion status is temporarily unavailable", "internal");
  }
  if (!evidence) {
    return Response.json({ status: "expired-or-unknown" }, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  return Response.json({
    operationId: credentials.operationId,
    status: publicStatus(evidence),
  }, {
    status: evidence.state === "complete" ? 200 : 202,
    headers: { "cache-control": "no-store" },
  });
}
