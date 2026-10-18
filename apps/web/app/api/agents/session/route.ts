// SPDX-License-Identifier: Apache-2.0
import { jsonError } from "@web/lib/api-error-response.server.js";
import { withProjectReadRequest } from "@web/lib/session/project-request-fence.server.js";
import { handleAgentSessionDelete, handleAgentSessionPost, isLoopbackRequest } from "./handler.js";

/**
 * Runs the selected agent CLI in the active project's folder and streams its events (SSE).
 * The project comes from the server-side session, never from the request body; write locking and
 * schema validation of the result belong to the agent-safety layer (VTL-32).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOT_LOOPBACK = "Agent runs are only available from localhost";

export async function POST(req: Request): Promise<Response> {
  if (!isLoopbackRequest(req)) return jsonError(403, NOT_LOOPBACK);
  return withProjectReadRequest(req, ({ projectPath }) => handleAgentSessionPost(projectPath, req));
}

export async function DELETE(req: Request): Promise<Response> {
  if (!isLoopbackRequest(req)) return jsonError(403, NOT_LOOPBACK);
  return withProjectReadRequest(req, ({ projectPath }) => handleAgentSessionDelete(projectPath));
}
