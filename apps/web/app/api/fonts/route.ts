// SPDX-License-Identifier: Apache-2.0
import { handleFontDelete, handleFontGet, handleFontPost } from "./handler.js";
import {
  withProjectMutationRequest,
  withProjectReadRequest,
} from "../../../lib/project-request-fence.server.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return withProjectReadRequest(
    req,
    ({ projectPath }) => handleFontGet(projectPath),
  );
}

export async function POST(req: Request): Promise<Response> {
  return withProjectMutationRequest(
    req,
    ({ projectPath }, expectedRevision) => (
      handleFontPost(projectPath, req, {}, expectedRevision)
    ),
  );
}

export async function DELETE(req: Request): Promise<Response> {
  return withProjectMutationRequest(
    req,
    ({ projectPath }, expectedRevision) => (
      handleFontDelete(projectPath, req, {}, expectedRevision)
    ),
  );
}
