// SPDX-License-Identifier: Apache-2.0
import { listProjectImageAssets } from "@web/lib/project-assets.server.js";
import {
  withProjectMutationRequest,
  withProjectReadRequest,
} from "@web/lib/project-request-fence.server.js";
import { handleAssetPost } from "./handler.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return withProjectReadRequest(req, async ({ projectPath }) => {
    try {
      return Response.json({ assets: await listProjectImageAssets(projectPath) });
    } catch (error) {
      return jsonError(500, (error as Error).message || "Failed to list project assets");
    }
  });
}

export async function POST(req: Request): Promise<Response> {
  return withProjectMutationRequest(
    req,
    ({ projectPath }, expectedRevision) => (
      handleAssetPost(projectPath, req, {}, expectedRevision)
    ),
  );
}
