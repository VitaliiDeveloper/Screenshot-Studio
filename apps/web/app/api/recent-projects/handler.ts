// SPDX-License-Identifier: Apache-2.0
import {
  recentProjectsStore,
  type RecentProjectsStore,
} from "@web/lib/recent-projects.server.js";
import {
  projectSessionRegistry,
  type ProjectSessionRegistry,
} from "@web/lib/project-session.server.js";
import { projectSessionResponseHeaders } from "@web/app/api/project-session/handler.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

const RECENT_ID_PATTERN = /^recent_[0-9a-f]{32}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function recentIdFromBody(request: Request): Promise<string> {
  const value = await request.json() as unknown;
  if (!isRecord(value) || Object.keys(value).length !== 1
    || typeof value.recentId !== "string" || !RECENT_ID_PATTERN.test(value.recentId)) {
    throw new TypeError("Invalid recent project request");
  }
  return value.recentId;
}

function badRequest(): Response {
  return jsonError(400, "A valid recent project id is required.");
}

export async function handleRecentProjectsGet(
  store: RecentProjectsStore = recentProjectsStore,
): Promise<Response> {
  try {
    return Response.json(await store.list(), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return jsonError(500, "Recent projects could not be loaded. Retry, or reopen a project from its source.");
  }
}

export async function handleRecentProjectsDelete(
  request: Request,
  store: RecentProjectsStore = recentProjectsStore,
): Promise<Response> {
  let recentId: string;
  try {
    recentId = await recentIdFromBody(request);
  } catch {
    return badRequest();
  }
  try {
    if (!await store.remove(recentId)) {
      return jsonError(404, "Recent project does not exist.");
    }
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch {
    return jsonError(500, "Recent project could not be removed. Retry.");
  }
}

export async function handleRecentProjectOpen(
  request: Request,
  store: RecentProjectsStore = recentProjectsStore,
  registry: ProjectSessionRegistry = projectSessionRegistry,
): Promise<Response> {
  let recentId: string;
  try {
    recentId = await recentIdFromBody(request);
  } catch {
    return badRequest();
  }
  try {
    const session = await store.activate(recentId, registry);
    return Response.json({ projectId: session.projectId }, {
      headers: projectSessionResponseHeaders(session, request),
    });
  } catch {
    return jsonError(409, "This recent project is unavailable. Reopen or import the source to add it again.");
  }
}
