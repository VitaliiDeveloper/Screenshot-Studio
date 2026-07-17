// SPDX-License-Identifier: Apache-2.0
import { handleTemplateGet, handleTemplatePost } from "./handler.js";
import { withActiveProjectSession } from "../../../lib/project-session.server.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return withActiveProjectSession(
    req,
    ({ projectPath }) => handleTemplateGet(projectPath),
  );
}

export async function POST(req: Request): Promise<Response> {
  return withActiveProjectSession(
    req,
    ({ projectPath }) => handleTemplatePost(projectPath, req),
  );
}
