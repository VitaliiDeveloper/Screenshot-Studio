// SPDX-License-Identifier: Apache-2.0
import { handleProjectSessionDelete, handleProjectSessionGet } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleProjectSessionGet(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleProjectSessionDelete(request);
}
