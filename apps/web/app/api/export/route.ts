// SPDX-License-Identifier: Apache-2.0
import { handleExportPost } from "./handler.js";
import { withProjectMutationRequest } from "@web/lib/session/project-request-fence.server.js";

/**
 * UI export writes the same lead-size roots plus opt-in exact variants that the CLI writes, from the same
 * on-disk project JSON, through the same headless /render path — but reuses THIS Next host as the
 * render host (decision 4): one browser session, `baseUrl` = request origin, no spawned server.
 * All pre-render validation runs before the browser launches, so bad input fails fast as 422.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return withProjectMutationRequest(
    req,
    ({ projectPath }, expectedRevision) => (
      handleExportPost(projectPath, req, {}, expectedRevision)
    ),
  );
}
