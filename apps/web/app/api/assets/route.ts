// SPDX-License-Identifier: Apache-2.0
import { listProjectImageAssets } from "../../../lib/project-assets.server.js";
import { resolveProjectPath } from "../../../lib/project-path.js";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ assets: await listProjectImageAssets(resolveProjectPath()) });
  } catch (error) {
    return Response.json(
      { error: (error as Error).message || "Failed to list project assets" },
      { status: 500 },
    );
  }
}
