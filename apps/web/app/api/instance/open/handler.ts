// SPDX-License-Identifier: Apache-2.0
import { isAbsolute } from "node:path";
import { isLoopbackRequest } from "@web/lib/agents/loopback-request.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";
import {
  projectSessionRegistry,
  type ProjectSessionRegistry,
} from "@web/lib/session/project-session.server.js";
import {
  recentProjectsStore,
  type RecentProjectsStore,
} from "@web/lib/session/recent-projects.server.js";

export const CLI_REQUEST_HEADER = "x-screenshot-studio-cli";

// Only the installed CLI may hand this host a filesystem path. Browsers send Origin on every POST,
// a cross-site custom header needs a preflight the host never grants, and a loopback Host header
// rules out DNS rebinding.
function isCliRequest(request: Request): boolean {
  return request.headers.get("origin") === null
    && request.headers.get(CLI_REQUEST_HEADER) === "1"
    && isLoopbackRequest(request);
}

export async function handleInstanceOpenPost(
  request: Request,
  store: Pick<RecentProjectsStore, "openLocal"> = recentProjectsStore,
  registry: ProjectSessionRegistry = projectSessionRegistry,
): Promise<Response> {
  if (!isCliRequest(request)) {
    return jsonError(403, "Only the screenshots CLI can open a project by path.");
  }
  const body: unknown = await request.json().catch(() => null);
  const projectPath = (body as { projectPath?: unknown } | null)?.projectPath;
  if (typeof projectPath !== "string" || !isAbsolute(projectPath)) {
    return jsonError(400, "projectPath must be an absolute path.");
  }
  try {
    const entryId = await store.openLocal(projectPath, registry);
    return Response.json({ entryId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(422, error instanceof Error ? error.message : String(error));
  }
}
