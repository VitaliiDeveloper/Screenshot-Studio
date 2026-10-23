// SPDX-License-Identifier: Apache-2.0
import { rejectNonLoopbackRequest } from "@web/lib/agents/loopback-request.server.js";
import { withProjectReadRequest } from "@web/lib/session/project-request-fence.server.js";
import { handleSystemFontsGet, SYSTEM_FONTS_LOCAL_ONLY } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req, SYSTEM_FONTS_LOCAL_ONLY)
    ?? withProjectReadRequest(req, () => handleSystemFontsGet());
}
