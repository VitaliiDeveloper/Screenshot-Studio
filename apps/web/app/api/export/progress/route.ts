// SPDX-License-Identifier: Apache-2.0
import { handleExportProgressGet } from "./handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  return handleExportProgressGet(request);
}
