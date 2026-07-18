// SPDX-License-Identifier: Apache-2.0
import { ProjectRevisionConflictError } from "@screenshot-studio/core/storage";
import { isStrongQuotedETag } from "./http-etag.js";
import {
  withActiveProjectSession,
  type ActiveProjectResolverDependencies,
  type LocalProjectSession,
} from "./project-session.server.js";

type ProjectRequestOperation = (
  session: LocalProjectSession,
  expectedRevision?: string,
) => Promise<Response> | Response;

function quotedRevision(revision: string): string {
  return `"${revision}"`;
}

function projectIdentityResponse(
  req: Request,
  session: LocalProjectSession,
): Response | undefined {
  const expectedProjectId = req.headers.get("x-project-id")?.trim();
  if (!expectedProjectId) {
    return Response.json(
      { error: "X-Project-Id is required for this project operation" },
      { status: 428 },
    );
  }
  if (expectedProjectId !== session.projectId) {
    return Response.json(
      { error: "Active project changed; reload it before continuing" },
      { status: 409 },
    );
  }
}

export function withProjectReadRequest(
  req: Request,
  operation: ProjectRequestOperation,
  dependencies: ActiveProjectResolverDependencies = {},
): Promise<Response> {
  return withActiveProjectSession(req, async (session) => {
    const identityError = projectIdentityResponse(req, session);
    return identityError ?? operation(session);
  }, dependencies);
}

export function withProjectMutationRequest(
  req: Request,
  operation: ProjectRequestOperation,
): Promise<Response> {
  return withActiveProjectSession(req, async (session) => {
    const identityError = projectIdentityResponse(req, session);
    if (identityError) return identityError;

    const expectedRevision = req.headers.get("if-match");
    if (expectedRevision === null) {
      return Response.json(
        { error: "If-Match is required for this project operation" },
        { status: 428 },
      );
    }
    if (!isStrongQuotedETag(expectedRevision)) {
      return Response.json(
        { error: "If-Match must be one strong quoted ETag" },
        { status: 400 },
      );
    }
    return operation(session, expectedRevision.slice(1, -1));
  });
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
