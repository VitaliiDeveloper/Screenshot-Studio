// SPDX-License-Identifier: Apache-2.0
import { isAbsolute } from "node:path";
import { isStrongQuotedETag } from "@web/lib/http-etag.js";
import { withManagedProjectReadGuard } from "@web/lib/managed-project-mutation-guard.server.js";
import {
  serveProjectAssetPath,
  withPrivateAssetPolicy,
} from "@web/lib/project-asset.server.js";
import { withActiveProjectSession } from "@web/lib/project-session.server.js";

/**
 * Serves the project's asset files over HTTP so /editor and the headless /render resolve the SAME
 * URL for a given screenshot assetUrl — parity by construction, and same-origin so images never
 * taint the canvas. Dev-only, local, self-hosted (same model as /render, /api/project).
 * `project` (optional) lets the headless render pass its own project path; interactive requests use
 * the active project session.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const rel = url.searchParams.get("path");
  const explicitProjectPath = url.searchParams.get("project");
  const interactive = !explicitProjectPath;
  const finish = (response: Response) => withPrivateAssetPolicy(response, interactive);
  if (!rel) return finish(Response.json({ error: "missing path" }, { status: 400 }));

  if (isAbsolute(rel)) {
    return finish(Response.json({ error: "path outside project" }, { status: 400 }));
  }

  if (explicitProjectPath) return finish(await serveProjectAssetPath(explicitProjectPath, rel));
  const requestedProjectId = url.searchParams.get("projectId")?.trim();
  const resourceRevision = url.searchParams.get("revision")?.trim();
  const response = await withActiveProjectSession(req, (session) => {
    const { projectId, projectPath } = session;
    if (!requestedProjectId || !resourceRevision) {
      return Promise.resolve(Response.json(
        { error: "projectId and revision are required for interactive assets" },
        { status: 400 },
      ));
    }
    if (!isStrongQuotedETag(resourceRevision)) {
      return Promise.resolve(Response.json(
        { error: "revision must be one strong quoted ETag" },
        { status: 400 },
      ));
    }
    if (requestedProjectId !== projectId) {
      return Promise.resolve(Response.json(
        { error: "Asset URL belongs to a different active project" },
        { status: 409 },
      ));
    }
    return withManagedProjectReadGuard(session, () => serveProjectAssetPath(projectPath, rel));
  });
  return finish(response);
}
