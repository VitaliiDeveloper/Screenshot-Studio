// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { parseProject, ProjectValidationError } from "@screenshot-studio/core/model";
import {
  ProjectPathError,
  ProjectRevisionConflictError,
  readIdentifiedProjectSnapshot,
  readProjectSnapshot,
  resolveExistingProjectPath,
  withProjectMutation,
  writeProjectConditionalAtomic,
} from "@screenshot-studio/core/storage";
import { resolveProjectPath } from "../../../lib/project-path.js";

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

function projectIdentifier(canonicalPath: string): string {
  return createHash("sha256").update(canonicalPath).digest("hex");
}

function isStrongQuotedETag(value: string): boolean {
  if (value.length < 3 || value[0] !== '"' || value.at(-1) !== '"') return false;
  for (const character of value.slice(1, -1)) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x20 || codePoint === 0x22 || codePoint === 0x7f) return false;
  }
  return true;
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

export async function GET(): Promise<Response> {
  try {
    const path = await resolveExistingProjectPath(resolveProjectPath());
    const snapshot = await readProjectSnapshot(path);
    return Response.json(snapshot.project, {
      headers: {
        etag: quotedRevision(snapshot.revision),
        "x-project-id": projectIdentifier(path),
      },
    });
  } catch (err) {
    const status = err instanceof ProjectValidationError ? 422 : 404;
    return Response.json({ error: (err as Error).message }, { status });
  }
}

export async function PUT(req: Request): Promise<Response> {
  const expectedRevision = req.headers.get("if-match");
  if (expectedRevision === null) {
    return Response.json({ error: "If-Match is required to save the project" }, { status: 428 });
  }
  if (!isStrongQuotedETag(expectedRevision)) {
    return Response.json({ error: "If-Match must be one strong quoted ETag" }, { status: 400 });
  }

  let project;
  try {
    project = parseProject(await req.json());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }

  try {
    const path = await resolveExistingProjectPath(resolveProjectPath());
    return await withProjectMutation(path, async () => {
      const current = await readIdentifiedProjectSnapshot(path);
      const actualRevision = quotedRevision(current.revision);
      if (expectedRevision !== actualRevision) {
        return revisionConflictResponse(expectedRevision, actualRevision);
      }

      const persisted = await writeProjectConditionalAtomic(path, project, current);
      return Response.json(persisted.project, {
        headers: { etag: quotedRevision(persisted.revision) },
      });
    });
  } catch (error) {
    return projectWriteErrorResponse(error);
  }
}
