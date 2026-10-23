// SPDX-License-Identifier: Apache-2.0
import { rejectNonLoopbackRequest } from "@web/lib/agents/loopback-request.server.js";
import { withProjectReadRequest } from "@web/lib/session/project-request-fence.server.js";
import { handleAgentConsentPost } from "./handler.js";

/**
 * Grants or revokes consent for an `at-own-risk` agent in the app's local settings. It sits behind
 * the project session fence only for its `X-Project-Id` header: a custom header makes a cross-site
 * page send a CORS preflight, so no foreign page can grant consent with a blind POST.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req) ?? withProjectReadRequest(req, () => handleAgentConsentPost(req));
}
