// SPDX-License-Identifier: Apache-2.0
import { withAgentRunFence } from "@web/lib/agents/agent-run-guard.server.js";
import { rejectNonLoopbackRequest } from "@web/lib/agents/loopback-request.server.js";
import { withProjectReadRequest } from "@web/lib/session/project-request-fence.server.js";
import { handleUploadPlanPost } from "@web/app/api/upload/handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** An Apple plan reads App Store Connect with the stored key, so it is refused while an agent runs, like the key routes. */
export async function POST(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req) ?? withProjectReadRequest(
    req,
    (session) => withAgentRunFence(session.projectPath, () => handleUploadPlanPost(session, req)),
  );
}
