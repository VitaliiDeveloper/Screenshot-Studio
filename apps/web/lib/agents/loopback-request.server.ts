// SPDX-License-Identifier: Apache-2.0
import { jsonError } from "@web/lib/api-error-response.server.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** DNS rebinding reaches the loopback server under a foreign Host; agent routes spawn local CLIs. */
export function isLoopbackRequest(req: Request): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(`http://${req.headers.get("host") ?? new URL(req.url).host}`).hostname);
  } catch {
    return false;
  }
}

export function rejectNonLoopbackRequest(req: Request): Response | undefined {
  return isLoopbackRequest(req) ? undefined : jsonError(403, "Agents are only available from localhost");
}
