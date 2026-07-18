// SPDX-License-Identifier: Apache-2.0
import {
  NoActiveProjectError,
  PROJECT_SESSION_COOKIE,
  projectSessionRegistry,
  projectSessionErrorResponse,
  resolveActiveProjectSession,
  sessionIdFromRequest,
  type ActiveProjectResolverDependencies,
} from "@web/lib/project-session.server.js";

export function projectSessionCookieValue(sessionId: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function expiredProjectSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${PROJECT_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function descriptorResponse(
  session: Awaited<ReturnType<typeof resolveActiveProjectSession>>,
  request: Request,
): Response {
  return Response.json(session.descriptor, {
    headers: {
      "cache-control": "no-store",
      "set-cookie": projectSessionCookieValue(session.descriptor.sessionId, request),
      "x-project-id": session.projectId,
    },
  });
}

export async function handleProjectSessionGet(
  request: Request,
  dependencies: ActiveProjectResolverDependencies = {},
): Promise<Response> {
  try {
    return descriptorResponse(await resolveActiveProjectSession(request, dependencies), request);
  } catch (error) {
    if (error instanceof NoActiveProjectError) {
      return new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
      });
    }
    return projectSessionErrorResponse(error);
  }
}

export async function handleProjectSessionDelete(
  request: Request,
  dependencies: ActiveProjectResolverDependencies = {},
): Promise<Response> {
  const expectedProjectId = request.headers.get("x-project-id")?.trim();
  if (!expectedProjectId) {
    return Response.json(
      { error: "X-Project-Id is required to close the active project" },
      { status: 428 },
    );
  }

  const registry = dependencies.registry ?? projectSessionRegistry;
  const sessionId = sessionIdFromRequest(request);
  const session = sessionId ? registry.get(sessionId) : undefined;
  if (session && session.projectId !== expectedProjectId) {
    return Response.json(
      { error: "Active project changed; reload it before continuing" },
      { status: 409 },
    );
  }
  if (sessionId && session) registry.close(sessionId, expectedProjectId);
  return new Response(null, {
    status: 204,
    headers: {
      "cache-control": "no-store",
      "set-cookie": expiredProjectSessionCookie(request),
    },
  });
}
