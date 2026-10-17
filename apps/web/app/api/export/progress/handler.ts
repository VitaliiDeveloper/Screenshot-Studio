// SPDX-License-Identifier: Apache-2.0
import {
  exportProgressRegistry,
  type ExportProgressRegistry,
} from "@web/lib/export-progress.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

export function handleExportProgressGet(
  request: Request,
  registry: Pick<ExportProgressRegistry, "get"> = exportProgressRegistry,
): Response {
  const operationId = new URL(request.url).searchParams.get("operationId") ?? "";
  try {
    const progress = registry.get(operationId);
    if (!progress) {
      return jsonError(404, "Export operation was not found");
    }
    return Response.json(progress, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(400, (error as Error).message);
  }
}
