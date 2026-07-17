// SPDX-License-Identifier: Apache-2.0
import { handleFontDelete, handleFontGet, handleFontPost } from "./handler.js";
import { withActiveProjectSession } from "../../../lib/project-session.server.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return withActiveProjectSession(
    req,
    ({ projectPath }) => handleFontGet(projectPath),
  );
}

export async function POST(req: Request): Promise<Response> {
  return withActiveProjectSession(
    req,
    ({ projectPath }) => handleFontPost(projectPath, req),
  );
}

export async function DELETE(req: Request): Promise<Response> {
  return withActiveProjectSession(
    req,
    ({ projectPath }) => handleFontDelete(projectPath, req),
  );
}
