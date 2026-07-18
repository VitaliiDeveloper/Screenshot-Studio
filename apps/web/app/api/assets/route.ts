// SPDX-License-Identifier: Apache-2.0
import { listProjectImageAssets } from "../../../lib/project-assets.server.js";
import { withActiveProjectSession } from "../../../lib/project-session.server.js";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return withActiveProjectSession(req, async ({ projectPath }) => {
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
