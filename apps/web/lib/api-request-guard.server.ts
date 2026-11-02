// SPDX-License-Identifier: Apache-2.0
import { isLoopbackRequest, requestHost } from "@web/lib/agents/loopback-request.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

const SAFE_METHODS = new Set(["GET", "HEAD"]);
// Another localhost port is `same-site`, so it is as foreign as any other page.
const FOREIGN_FETCH_SITES = new Set(["cross-site", "same-site"]);

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

function isCrossSiteWrite(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  const origin = req.headers.get("origin");
  return (origin !== null && hostOf(origin) !== hostOf(`http://${requestHost(req)}`))
    || FOREIGN_FETCH_SITES.has(req.headers.get("sec-fetch-site") ?? "");
}

/**
 * The editor binds loopback, so a page the user visits reaches `/api/*` only through DNS rebinding
 * (a foreign Host) or a CORS-simple cross-site write such as a `no-cors` multipart POST.
 */
export function rejectForeignApiRequest(req: Request): Response | undefined {
  if (!isLoopbackRequest(req)) return jsonError(403, "The editor API is only available from localhost");
  if (isCrossSiteWrite(req)) return jsonError(403, "Cross-site requests to the editor API are refused");
  return undefined;
}
