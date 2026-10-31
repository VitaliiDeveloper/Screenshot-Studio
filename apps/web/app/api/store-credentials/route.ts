// SPDX-License-Identifier: Apache-2.0
import { dirname } from "node:path";
import { rejectNonLoopbackRequest } from "@web/lib/agents/loopback-request.server.js";
import { withProjectReadRequest } from "@web/lib/session/project-request-fence.server.js";
import {
  handleStoreCredentialsDelete,
  handleStoreCredentialsGet,
  handleStoreCredentialsPost,
} from "./handler.js";

/**
 * Store keys live in the app data root, never in a project. The project session fence is here for its
 * `X-Project-Id` header (a blind cross-site request cannot send it) and for the active project folder,
 * which the key folder must stay outside of.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req) ?? withProjectReadRequest(req, () => handleStoreCredentialsGet());
}

export async function POST(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req) ?? withProjectReadRequest(req, (session) => (
    handleStoreCredentialsPost(req, dirname(session.projectPath))
  ));
}

export async function DELETE(req: Request): Promise<Response> {
  return rejectNonLoopbackRequest(req) ?? withProjectReadRequest(req, () => handleStoreCredentialsDelete(req));
}
