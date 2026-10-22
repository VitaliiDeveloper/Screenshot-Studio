// SPDX-License-Identifier: Apache-2.0
import { rejectNonLoopbackRequest } from "@web/lib/agents/loopback-request.server.js";
import { withProjectMutationRequest } from "@web/lib/session/project-request-fence.server.js";
import { handleSystemFontImport } from "@web/app/api/system-fonts/handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req, "System fonts are only available from localhost")
    ?? withProjectMutationRequest(
      req,
      ({ projectPath }, expectedRevision) => (
        handleSystemFontImport(projectPath, req, undefined, {}, expectedRevision)
      ),
    );
}
