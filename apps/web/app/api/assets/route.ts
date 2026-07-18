// SPDX-License-Identifier: Apache-2.0
import { listProjectImageAssets } from "@web/lib/project-assets.server.js";
import { withProjectReadRequest } from "@web/lib/project-request-fence.server.js";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return withProjectReadRequest(req, async ({ projectPath }) => {
    try {
      return Response.json({ assets: await listProjectImageAssets(projectPath) });
    } catch (error) {
      return Response.json(
        { error: (error as Error).message || "Failed to list project assets" },
        { status: 500 },
      );
    }
  });
}
