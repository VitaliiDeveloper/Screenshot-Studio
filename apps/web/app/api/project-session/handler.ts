// SPDX-License-Identifier: Apache-2.0
import {
  NoActiveProjectError,
  PROJECT_SESSION_COOKIE,
  projectSessionErrorResponse,
  resolveActiveProjectSession,
  type ActiveProjectResolverDependencies,
} from "@web/lib/project-session.server.js";

export function projectSessionCookieValue(sessionId: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function descriptorResponse(
  session: Awaited<ReturnType<typeof resolveActiveProjectSession>>,
  request: Request,
): Response {
  return Response.json(session.descriptor, {
    headers: {
      "cache-control": "no-store",
      "set-cookie": projectSessionCookieValue(session.descriptor.sessionId, request),
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
