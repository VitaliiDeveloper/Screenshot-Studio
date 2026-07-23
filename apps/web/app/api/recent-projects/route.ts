// SPDX-License-Identifier: Apache-2.0
import { handleRecentProjectsDelete, handleRecentProjectsGet } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return handleRecentProjectsGet();
}

export async function DELETE(request: Request): Promise<Response> {
  return handleRecentProjectsDelete(request);
}
