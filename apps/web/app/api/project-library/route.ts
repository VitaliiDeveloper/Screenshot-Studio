// SPDX-License-Identifier: Apache-2.0
import { handleProjectLibraryGet, handleProjectLibraryOpen } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return handleProjectLibraryGet();
}

export async function POST(request: Request): Promise<Response> {
  return handleProjectLibraryOpen(request);
}
