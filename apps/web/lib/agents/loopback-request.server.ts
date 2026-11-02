// SPDX-License-Identifier: Apache-2.0
import { jsonError } from "@web/lib/api-error-response.server.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** DNS rebinding reaches the loopback server under a foreign Host; local-only routes reject it. */
export function isLoopbackHost(host: string | null): boolean {
  try {
    return host !== null && LOOPBACK_HOSTS.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

export function requestHost(req: Request): string {
  return req.headers.get("host") ?? new URL(req.url).host;
}

export function isLoopbackRequest(req: Request): boolean {
  return isLoopbackHost(requestHost(req));
}

export function rejectNonLoopbackRequest(
  req: Request,
  message = "Agents are only available from localhost",
): Response | undefined {
  return isLoopbackRequest(req) ? undefined : jsonError(403, message);
}
