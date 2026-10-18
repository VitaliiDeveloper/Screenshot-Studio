// SPDX-License-Identifier: Apache-2.0
import { rejectNonLoopbackRequest } from "@web/lib/agents/loopback-request.server.js";
import { withProjectReadRequest } from "@web/lib/session/project-request-fence.server.js";
import { handleAgentSessionDelete, handleAgentSessionPost } from "./handler.js";

/**
 * Runs the selected agent CLI in the active project's folder and streams its events (SSE).
 * The project comes from the server-side session, never from the request body; write locking and
 * schema validation of the result belong to the agent-safety layer (VTL-32).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req)
    ?? withProjectReadRequest(req, ({ projectPath }) => handleAgentSessionPost(projectPath, req));
}

export async function DELETE(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req)
    ?? withProjectReadRequest(req, ({ projectPath }) => handleAgentSessionDelete(projectPath));
}
