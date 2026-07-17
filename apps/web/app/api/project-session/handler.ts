// SPDX-License-Identifier: Apache-2.0
import {
  NoActiveProjectError,
  PROJECT_SESSION_COOKIE,
  projectSessionErrorResponse,
  projectSessionRegistry,
  resolveActiveProjectSession,
  type ActiveProjectResolverDependencies,
} from "../../../lib/project-session.server.js";

function cookieValue(sessionId: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function clearCookie(request: Request): string {
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
      "set-cookie": cookieValue(session.descriptor.sessionId, request),
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
        headers: { "cache-control": "no-store", "set-cookie": clearCookie(request) },
      });
    }
    return projectSessionErrorResponse(error);
  }
}

export async function handleProjectSessionPost(
  request: Request,
  dependencies: ActiveProjectResolverDependencies = {},
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const path = typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as { path?: unknown }).path
    : undefined;
  if (typeof path !== "string" || !path.trim()) {
    return Response.json({ error: "path must be a non-empty string" }, { status: 400 });
  }
  try {
    const session = await (dependencies.registry ?? projectSessionRegistry).openLocal(path.trim());
    return descriptorResponse(session, request);
  } catch (error) {
    return projectSessionErrorResponse(error);
  }
}
