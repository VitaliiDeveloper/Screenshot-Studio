// SPDX-License-Identifier: Apache-2.0
import { rejectNonLoopbackRequest } from "@web/lib/agents/loopback-request.server.js";
import { withProjectReadRequest } from "@web/lib/session/project-request-fence.server.js";
import { handleSystemFontPreview } from "@web/app/api/system-fonts/handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req, "System fonts are only available from localhost")
    ?? withProjectReadRequest(req, () => handleSystemFontPreview(req));
}
