// SPDX-License-Identifier: Apache-2.0
import { rejectNonLoopbackRequest } from "@web/lib/agents/loopback-request.server.js";
import { withProjectReadRequest } from "@web/lib/session/project-request-fence.server.js";
import { handleUploadPlanPost } from "@web/app/api/upload/handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req) ?? withProjectReadRequest(req, (session) => handleUploadPlanPost(session, req));
}
