// SPDX-License-Identifier: Apache-2.0
import { handleProjectArchivePost } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleProjectArchivePost(request);
}
