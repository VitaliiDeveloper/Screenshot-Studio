// SPDX-License-Identifier: Apache-2.0
import { handleRecentProjectOpen } from "../handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleRecentProjectOpen(request);
}
