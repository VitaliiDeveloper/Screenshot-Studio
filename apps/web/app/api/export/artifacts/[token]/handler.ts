// SPDX-License-Identifier: Apache-2.0
import { Readable } from "node:stream";
import {
  consumeExportArtifact,
  type ExportArtifactLookup,
} from "@web/lib/export-artifacts.server.js";

export interface ExportArtifactRouteDependencies {
  consumeArtifact?: (token: string) => Promise<ExportArtifactLookup>;
}

function unavailable(status: 404 | 410): Response {
  return Response.json({
    error: status === 410 ? "Export artifact expired" : "Export artifact not found",
  }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleExportArtifactGet(
  token: string,
  dependencies: ExportArtifactRouteDependencies = {},
): Promise<Response> {
  const consumeArtifact = dependencies.consumeArtifact ?? consumeExportArtifact;
  const lookup = await consumeArtifact(token);
  if (lookup.status === "expired") return unavailable(410);
  if (lookup.status !== "ready") return unavailable(404);

  const { artifact } = lookup;
  // Stream completion happens after this handler returns. Observe private-file cleanup explicitly so
  // a filesystem failure cannot surface as an unhandled rejection; the store retains it for retry.
  void artifact.cleanup.catch(() => undefined);
  try {
    return new Response(
      Readable.toWeb(artifact.stream) as ReadableStream<Uint8Array>,
      {
        status: 200,
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${artifact.filename}"`,
          "content-length": artifact.size.toString(),
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    await artifact.dispose();
    throw error;
  }
}
