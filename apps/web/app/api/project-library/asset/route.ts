// SPDX-License-Identifier: Apache-2.0
import { handleProjectLibraryAssetGet } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleProjectLibraryAssetGet(request);
}
