// SPDX-License-Identifier: Apache-2.0
import { handleProjectSessionGet, handleProjectSessionPost } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleProjectSessionGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleProjectSessionPost(request);
}
