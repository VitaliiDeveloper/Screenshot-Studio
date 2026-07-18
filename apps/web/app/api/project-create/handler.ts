// SPDX-License-Identifier: Apache-2.0
import { ProjectScaffoldInput } from "@screenshot-studio/core/scaffold";
import {
  ManagedProjectCreationError,
  ManagedProjectCreationService,
} from "@web/lib/managed-project-creation.server.js";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-project-config.server.js";
import { ManagedProjectRepository } from "@web/lib/managed-project-repository.server.js";
import {
  projectSessionRegistry,
  type ProjectSessionRegistry,
} from "@web/lib/project-session.server.js";
import { projectSessionCookieValue } from "../project-session/handler.js";

const MAX_CREATE_REQUEST_BYTES = 16_384;

class CreateRequestLimitError extends Error {}

export interface ProjectCreateRouteDependencies {
  service?: ManagedProjectCreationService;
  registry?: ProjectSessionRegistry;
}

function errorResponse(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new TypeError("Project creation request body is missing");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_CREATE_REQUEST_BYTES) throw new CreateRequestLimitError();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function handleProjectCreatePost(
  request: Request,
  dependencies: ProjectCreateRouteDependencies = {},
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLocaleLowerCase().startsWith("application/json")) {
    return errorResponse(415, "Project creation requires JSON", "unsupported-media-type");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      return errorResponse(400, "Project creation content length is invalid", "invalid-request");
    }
    if (bytes > MAX_CREATE_REQUEST_BYTES) {
      return errorResponse(413, "Project creation request exceeds the byte limit", "limit");
    }
  }

  let raw: unknown;
  try {
    raw = await readBoundedJson(request);
  } catch (error) {
    return error instanceof CreateRequestLimitError
      ? errorResponse(413, "Project creation request exceeds the byte limit", "limit")
      : errorResponse(400, "Project creation request is not valid JSON", "invalid-request");
  }
  const parsed = ProjectScaffoldInput.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(400, "Project creation fields are invalid", "invalid-request");
  }

  const service = dependencies.service ?? new ManagedProjectCreationService(
    new ManagedProjectRepository(resolveManagedProjectStorageConfig()),
  );
  const registry = dependencies.registry ?? projectSessionRegistry;
  let reservedSessionId: string;
  try {
    reservedSessionId = registry.reserveSessionId();
  } catch {
    return errorResponse(500, "Project creation failed", "internal");
  }
  try {
    const record = await service.create(parsed.data);
    const session = registry.openManagedRecord(record, reservedSessionId);
    return Response.json({ project: session.descriptor }, {
      status: 201,
      headers: {
        "cache-control": "no-store",
        "set-cookie": projectSessionCookieValue(session.descriptor.sessionId, request),
      },
    });
  } catch (error) {
    registry.releaseReservedSessionId(reservedSessionId);
    if (error instanceof ManagedProjectCreationError) {
      if (error.code === "limit") {
        return errorResponse(413, "Generated project exceeds configured limits", error.code);
      }
      if (error.code === "invalid-scaffold") {
        return errorResponse(
          422,
          "Project creation input is incompatible with the selected starter",
          error.code,
        );
      }
    }
    return errorResponse(500, "Project creation failed", "internal");
  }
}
