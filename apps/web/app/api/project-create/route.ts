// SPDX-License-Identifier: Apache-2.0
import { handleProjectCreatePost } from "./handler.js";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleProjectCreatePost(request);
}
