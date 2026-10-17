// SPDX-License-Identifier: Apache-2.0
import { isAbsolute } from "node:path";
import { isStrongQuotedETag } from "@web/lib/http-etag.js";
import { withManagedProjectReadGuard } from "@web/lib/managed-project-mutation-guard.server.js";
import {
  serveProjectAssetPath,
  withPrivateAssetPolicy,
} from "@web/lib/project-asset.server.js";
import { withActiveProjectSession } from "@web/lib/project-session.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

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
  if (!rel) return finish(jsonError(400, "missing path"));

  if (isAbsolute(rel)) {
    return finish(jsonError(400, "path outside project"));
  }

  if (explicitProjectPath) return finish(await serveProjectAssetPath(explicitProjectPath, rel));
  const requestedProjectId = url.searchParams.get("projectId")?.trim();
  const resourceRevision = url.searchParams.get("revision")?.trim();
  const response = await withActiveProjectSession(req, (session) => {
    const { projectId, projectPath } = session;
    if (!requestedProjectId || !resourceRevision) {
      return Promise.resolve(jsonError(400, "projectId and revision are required for interactive assets"));
    }
    if (!isStrongQuotedETag(resourceRevision)) {
      return Promise.resolve(jsonError(400, "revision must be one strong quoted ETag"));
    }
    if (requestedProjectId !== projectId) {
      return Promise.resolve(jsonError(409, "Asset URL belongs to a different active project"));
    }
    return withManagedProjectReadGuard(session, () => serveProjectAssetPath(projectPath, rel));
  });
  return finish(response);
}
