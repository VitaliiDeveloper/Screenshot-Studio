// SPDX-License-Identifier: Apache-2.0
import { handleThemeGet, handleThemePost } from "./handler.js";
import {
  withProjectMutationRequest,
  withProjectReadRequest,
} from "@web/lib/session/project-request-fence.server.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return withProjectReadRequest(
    req,
    ({ projectPath }) => handleThemeGet(projectPath),
  );
}

export async function POST(req: Request): Promise<Response> {
  return withProjectMutationRequest(
    req,
    ({ projectPath }, expectedRevision) => handleThemePost(projectPath, req, expectedRevision),
  );
}
