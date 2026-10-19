// SPDX-License-Identifier: Apache-2.0
import {
  projectLibraryService,
  type ProjectLibraryService,
} from "@web/lib/session/project-library.server.js";
import {
  projectSessionRegistry,
  type ProjectSessionRegistry,
} from "@web/lib/session/project-session.server.js";
import { projectSessionResponseHeaders } from "@web/app/api/project-session/handler.js";
import { jsonError } from "@web/lib/api-error-response.server.js";
import { isRecord } from "@web/lib/json-guards.js";

const ENTRY_ID_PATTERN = /^(?:project|recent)_[0-9a-f]{32}$/;

async function entryIdFromBody(request: Request): Promise<string> {
  const value = await request.json() as unknown;
  if (!isRecord(value) || Object.keys(value).length !== 1
    || typeof value.entryId !== "string" || !ENTRY_ID_PATTERN.test(value.entryId)) {
    throw new TypeError("Invalid project library request");
  }
  return value.entryId;
}

export async function handleProjectLibraryGet(
  service: Pick<ProjectLibraryService, "list"> = projectLibraryService,
): Promise<Response> {
  try {
    return Response.json(await service.list(), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return jsonError(500, "Projects could not be loaded. Retry, or reopen a local project from its source.");
  }
}

export async function handleProjectLibraryOpen(
  request: Request,
  service: Pick<ProjectLibraryService, "activate"> = projectLibraryService,
  registry: ProjectSessionRegistry = projectSessionRegistry,
): Promise<Response> {
  let entryId: string;
  try {
    entryId = await entryIdFromBody(request);
  } catch {
    return jsonError(400, "A valid project entry id is required.");
  }
  try {
    const session = await service.activate(entryId, registry);
    return Response.json({ projectId: session.projectId }, {
      headers: projectSessionResponseHeaders(session, request),
    });
  } catch {
    return jsonError(409, "This project is unavailable. Reopen or import its source to continue.");
  }
}
