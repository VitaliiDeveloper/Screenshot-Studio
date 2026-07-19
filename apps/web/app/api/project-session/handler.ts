// SPDX-License-Identifier: Apache-2.0
import {
  NoActiveProjectError,
  MANAGED_PROJECT_RECOVERY_COOKIE,
  PROJECT_SESSION_COOKIE,
  hasManagedProjectRecoveryCookie,
  projectSessionRegistry,
  projectSessionErrorResponse,
  resolveActiveProjectSession,
  sessionIdFromRequest,
  type ActiveProjectResolverDependencies,
  type ProjectSession,
} from "@web/lib/project-session.server.js";

export function projectSessionCookieValue(sessionId: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${PROJECT_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function managedProjectRecoveryCookieValue(projectId: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${MANAGED_PROJECT_RECOVERY_COOKIE}=${encodeURIComponent(projectId)}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function expiredManagedProjectRecoveryCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${MANAGED_PROJECT_RECOVERY_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function expiredProjectSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${PROJECT_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function projectSessionResponseHeaders(
  session: ProjectSession,
  request: Request,
): Headers {
  const headers = new Headers({ "cache-control": "no-store" });
  headers.append(
    "set-cookie",
    projectSessionCookieValue(session.descriptor.sessionId, request),
  );
  headers.append(
    "set-cookie",
    session.descriptor.sourceKind === "managed-project"
      ? managedProjectRecoveryCookieValue(session.projectId, request)
      : expiredManagedProjectRecoveryCookie(request),
  );
  return headers;
}

function descriptorResponse(
  session: Awaited<ReturnType<typeof resolveActiveProjectSession>>,
  request: Request,
): Response {
  const headers = projectSessionResponseHeaders(session, request);
  headers.set("x-project-id", session.projectId);
  return Response.json(session.descriptor, {
    headers,
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
      const headers = new Headers({ "cache-control": "no-store" });
      if (hasManagedProjectRecoveryCookie(request)) {
        headers.append("set-cookie", expiredManagedProjectRecoveryCookie(request));
      }
      return new Response(null, {
        status: 204,
        headers,
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
  const headers = new Headers({ "cache-control": "no-store" });
  headers.append("set-cookie", expiredProjectSessionCookie(request));
  headers.append("set-cookie", expiredManagedProjectRecoveryCookie(request));
  return new Response(null, {
    status: 204,
    headers,
  });
}
