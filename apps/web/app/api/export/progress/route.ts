// SPDX-License-Identifier: Apache-2.0
import { handleExportProgressGet, handleExportStopPost } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  return handleExportProgressGet(request);
}

export function POST(request: Request): Response {
  return handleExportStopPost(request);
}
