// SPDX-License-Identifier: Apache-2.0
import { parseProject, ProjectValidationError } from "@screenshot-studio/core/model";
import {
  ProjectPathError,
  ProjectRevisionConflictError,
  readIdentifiedProjectSnapshot,
  readProjectSnapshot,
  withProjectMutation,
  writeProjectConditionalAtomic,
} from "@screenshot-studio/core/storage";
import { reconcileCaptureImport } from "@screenshot-studio/cli/capture-import-recovery";
import { isStrongQuotedETag } from "@web/lib/http-etag.js";
import {
  withManagedProjectMutationGuard,
  withManagedProjectReadGuard,
} from "@web/lib/managed-projects/managed-project-mutation-guard.server.js";
import { withActiveProjectSession } from "@web/lib/session/project-session.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

/**
 * The editor's only persistence channel: the browser reads/writes the same on-disk
 * app-store-screenshots.json the CLI and /render use. PUT validates with the same strict core model,
 * then compares and writes inside the shared mutation coordinator so stale editor state cannot win.
 * Dev-only, local, self-hosted; arbitrary local file read is acceptable here (same as /render).
 */
export const dynamic = "force-dynamic";

function quotedRevision(revision: string): string {
  return `"${revision}"`;
}

function revisionConflictResponse(expectedRevision: string, actualRevision: string): Response {
  return Response.json({
    error: "Project changed on disk; reload it before saving again",
    expectedRevision,
    actualRevision,
  }, {
    status: 412,
    headers: { etag: actualRevision },
  });
}

function projectWriteErrorResponse(error: unknown): Response {
  if (error instanceof ProjectRevisionConflictError) {
    return revisionConflictResponse(
      quotedRevision(error.expected),
      quotedRevision(error.actual),
    );
  }
  const status = error instanceof ProjectPathError ? 400 : 500;
  const message = error instanceof Error ? error.message : String(error);
  return jsonError(status, message);
}

export async function GET(req: Request): Promise<Response> {
  return withActiveProjectSession(req, async (session) => {
    return withManagedProjectReadGuard(session, async () => {
      try {
        const snapshot = await readProjectSnapshot(session.projectPath);
        return Response.json(snapshot.project, {
          headers: {
            etag: quotedRevision(snapshot.revision),
            "x-project-id": session.projectId,
          },
        });
      } catch (err) {
        const status = err instanceof ProjectValidationError ? 422 : 404;
        return jsonError(status, (err as Error).message);
      }
    });
  });
}

export async function PUT(req: Request): Promise<Response> {
  const expectedRevision = req.headers.get("if-match");
  if (expectedRevision === null) {
    return jsonError(428, "If-Match is required to save the project");
  }
  if (!isStrongQuotedETag(expectedRevision)) {
    return jsonError(400, "If-Match must be one strong quoted ETag");
  }

  return withActiveProjectSession(req, async (session) => {
    const { projectId, projectPath } = session;
    const expectedProjectId = req.headers.get("x-project-id")?.trim();
    if (!expectedProjectId) {
      return jsonError(428, "X-Project-Id is required to save the project");
    }
    if (expectedProjectId !== projectId) {
      return jsonError(409, "Active project changed; reload it before saving again");
    }

    let project;
    try {
      project = parseProject(await req.json());
    } catch (err) {
      return jsonError(400, (err as Error).message);
    }

    try {
      return await withManagedProjectMutationGuard(session, () => withProjectMutation(projectPath, async () => {
        await reconcileCaptureImport(projectPath);
        const current = await readIdentifiedProjectSnapshot(projectPath);
        const actualRevision = quotedRevision(current.revision);
        if (expectedRevision !== actualRevision) {
          return revisionConflictResponse(expectedRevision, actualRevision);
        }

        const persisted = await writeProjectConditionalAtomic(projectPath, project, current);
        return Response.json(persisted.project, {
          headers: { etag: quotedRevision(persisted.revision) },
        });
      }));
    } catch (error) {
      return projectWriteErrorResponse(error);
    }
  });
}
