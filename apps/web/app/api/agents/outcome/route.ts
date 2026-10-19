// SPDX-License-Identifier: Apache-2.0
import { rejectNonLoopbackRequest } from "@web/lib/agents/loopback-request.server.js";
import { withProjectReadRequest } from "@web/lib/session/project-request-fence.server.js";
import { handleAgentOutcomeGet, handleAgentOutcomePost } from "./handler.js";

/**
 * Keep / Undo run for the active project's last accepted agent run. Undo writes the pre-run
 * snapshot back under the project mutation lock; it is a read request here because the revision
 * check is the run's own, not the editor's If-Match.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req)
    ?? withProjectReadRequest(req, ({ projectPath }) => handleAgentOutcomeGet(projectPath));
}

export async function POST(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req)
    ?? withProjectReadRequest(req, ({ projectPath }) => handleAgentOutcomePost(projectPath, req));
}
