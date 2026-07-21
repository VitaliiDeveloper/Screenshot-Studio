// SPDX-License-Identifier: Apache-2.0
import {
  exportProgressRegistry,
  type ExportProgressRegistry,
} from "@web/lib/export-progress.server.js";

export function handleExportProgressGet(
  request: Request,
  registry: Pick<ExportProgressRegistry, "get"> = exportProgressRegistry,
): Response {
  const operationId = new URL(request.url).searchParams.get("operationId") ?? "";
  try {
    const progress = registry.get(operationId);
    if (!progress) {
      return Response.json({ error: "Export operation was not found" }, {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }
    return Response.json(progress, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
}
