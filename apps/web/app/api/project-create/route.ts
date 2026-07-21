// SPDX-License-Identifier: Apache-2.0
import { handleProjectCreatePost } from "@web/app/api/project-create/handler.js";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleProjectCreatePost(request);
}
