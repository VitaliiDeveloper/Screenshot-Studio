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
} from "@web/lib/managed-project-mutation-guard.server.js";
import { withActiveProjectSession } from "@web/lib/project-session.server.js";

/**
 * The editor's only persistence channel (spec §5): the browser reads/writes the same on-disk
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
  return Response.json({ error: message }, { status });
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
        return Response.json({ error: (err as Error).message }, { status });
      }
    });
  });
}

export async function PUT(req: Request): Promise<Response> {
  const expectedRevision = req.headers.get("if-match");
  if (expectedRevision === null) {
    return Response.json({ error: "If-Match is required to save the project" }, { status: 428 });
  }
  if (!isStrongQuotedETag(expectedRevision)) {
    return Response.json({ error: "If-Match must be one strong quoted ETag" }, { status: 400 });
  }

  return withActiveProjectSession(req, async (session) => {
    const { projectId, projectPath } = session;
    const expectedProjectId = req.headers.get("x-project-id")?.trim();
    if (!expectedProjectId) {
      return Response.json(
        { error: "X-Project-Id is required to save the project" },
        { status: 428 },
      );
    }
    if (expectedProjectId !== projectId) {
      return Response.json(
        { error: "Active project changed; reload it before saving again" },
        { status: 409 },
      );
    }

    let project;
    try {
      project = parseProject(await req.json());
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 400 });
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
