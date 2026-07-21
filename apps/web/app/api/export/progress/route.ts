// SPDX-License-Identifier: Apache-2.0
import { handleExportProgressGet } from "@web/app/api/export/progress/handler.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  return handleExportProgressGet(request);
}
