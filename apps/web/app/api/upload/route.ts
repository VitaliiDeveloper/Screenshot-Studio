// SPDX-License-Identifier: Apache-2.0
import { rejectNonLoopbackRequest } from "@web/lib/agents/loopback-request.server.js";
import { withProjectMutationRequest } from "@web/lib/session/project-request-fence.server.js";
import { handleUploadPost } from "./handler.js";

/**
 * Uploads a reviewed plan to the store. It holds the project mutation guard like /api/export, so the
 * editor cannot change the project mid-upload, and the agent-run fence refuses it while an
 * editor-started agent runs. Agent routes have no path here.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req) ?? withProjectMutationRequest(
    req,
    (session, expectedRevision) => handleUploadPost(session, req, expectedRevision),
  );
}
