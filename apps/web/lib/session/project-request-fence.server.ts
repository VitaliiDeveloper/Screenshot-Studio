// SPDX-License-Identifier: Apache-2.0
import { ProjectRevisionConflictError } from "@screenshot-studio/core/storage";
import { agentRunBlockResponse } from "@web/lib/agents/agent-run-guard.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";
import { isStrongQuotedETag } from "@web/lib/http-etag.js";
import {
  withManagedProjectMutationGuard,
  withManagedProjectReadGuard,
} from "@web/lib/managed-projects/managed-project-mutation-guard.server.js";
import type { ManagedProjectStorageConfig } from "@web/lib/managed-projects/managed-project-config.server.js";
import type { ManagedProjectLifecycleLock } from "@web/lib/managed-projects/managed-project-lifecycle-lock.server.js";
import {
  withActiveProjectSession,
  withExistingProjectSessionReadOnly,
  type ActiveProjectResolverDependencies,
  type LocalProjectSession,
} from "./project-session.server.js";

type ProjectRequestOperation = (
  session: LocalProjectSession,
  expectedRevision?: string,
  lifecycleLock?: ManagedProjectLifecycleLock,
) => Promise<Response> | Response;

type ProjectVersionedRequestOperation = (
  session: LocalProjectSession,
  expectedRevision: string,
  lifecycleLock?: ManagedProjectLifecycleLock,
) => Promise<Response> | Response;

export interface ProjectMutationRequestDependencies extends ActiveProjectResolverDependencies {
  managedStorageConfig?: ManagedProjectStorageConfig;
  managedReadGuard?: typeof withManagedProjectReadGuard;
}

export type ProjectReadRequestDependencies = ProjectMutationRequestDependencies;

function quotedRevision(revision: string): string {
  return `"${revision}"`;
}

function projectIdentityResponse(
  req: Request,
  session: LocalProjectSession,
): Response | undefined {
  const expectedProjectId = req.headers.get("x-project-id")?.trim();
  if (!expectedProjectId) {
    return jsonError(428, "X-Project-Id is required for this project operation");
  }
  if (expectedProjectId !== session.projectId) {
    return jsonError(409, "Active project changed; reload it before continuing");
  }
}

export function withProjectReadRequest(
  req: Request,
  operation: ProjectRequestOperation,
  dependencies: ProjectReadRequestDependencies = {},
): Promise<Response> {
  return withActiveProjectSession(req, async (session) => {
    const identityError = projectIdentityResponse(req, session);
    const readGuard = dependencies.managedReadGuard ?? withManagedProjectReadGuard;
    return identityError ?? readGuard(
      session,
      (lock) => Promise.resolve(operation(session, undefined, lock)),
      { config: dependencies.managedStorageConfig },
    );
  }, dependencies);
}

function expectedRevisionResponse(req: Request): string | Response {
  const expectedRevision = req.headers.get("if-match");
  if (expectedRevision === null) {
    return jsonError(428, "If-Match is required for this project operation");
  }
  if (!isStrongQuotedETag(expectedRevision)) {
    return jsonError(400, "If-Match must be one strong quoted ETag");
  }
  return expectedRevision.slice(1, -1);
}

export function withProjectVersionedReadRequest(
  req: Request,
  operation: ProjectVersionedRequestOperation,
  dependencies: ProjectReadRequestDependencies = {},
): Promise<Response> {
  return withExistingProjectSessionReadOnly(req, async (session) => {
    const identityError = projectIdentityResponse(req, session);
    if (identityError) return identityError;
    const expectedRevision = expectedRevisionResponse(req);
    const readGuard = dependencies.managedReadGuard ?? withManagedProjectReadGuard;
    return expectedRevision instanceof Response
      ? expectedRevision
      : readGuard(
        session,
        (lock) => Promise.resolve(operation(session, expectedRevision, lock)),
        { config: dependencies.managedStorageConfig },
      );
  }, dependencies);
}

export function withProjectMutationRequest(
  req: Request,
  operation: ProjectVersionedRequestOperation,
  dependencies: ProjectMutationRequestDependencies = {},
): Promise<Response> {
  return withActiveProjectSession(req, async (session) => {
    const identityError = projectIdentityResponse(req, session);
    if (identityError) return identityError;
    const agentBlock = await agentRunBlockResponse(session.projectPath);
    if (agentBlock) return agentBlock;

    const expectedRevision = expectedRevisionResponse(req);
    return expectedRevision instanceof Response
      ? expectedRevision
      : withManagedProjectMutationGuard(
        session,
        () => Promise.resolve(operation(session, expectedRevision)),
        { config: dependencies.managedStorageConfig },
      );
  }, dependencies);
}

export function projectRevisionConflictResponse(error: unknown): Response | undefined {
  if (!(error instanceof ProjectRevisionConflictError)) return undefined;
  return Response.json({
    error: "Project changed on disk; reload it before continuing",
    expectedRevision: quotedRevision(error.expected),
    actualRevision: quotedRevision(error.actual),
  }, {
    status: 412,
    headers: { etag: quotedRevision(error.actual) },
  });
}

type ErrorClass = abstract new (...args: never[]) => Error;

/** An ordered error-class → HTTP status table; the first class the error is an instance of wins. */
export type ErrorStatusTable = ReadonlyArray<readonly [ErrorClass, number]>;

/** Maps a thrown error to its response: a project revision conflict first, then `statuses`, else 500. */
export function errorResponseByClass(error: unknown, statuses: ErrorStatusTable): Response {
  const revisionConflict = projectRevisionConflictResponse(error);
  if (revisionConflict) return revisionConflict;
  const status = statuses.find(([ErrorType]) => error instanceof ErrorType)?.[1] ?? 500;
  return jsonError(status, error instanceof Error ? error.message : String(error));
}
