// SPDX-License-Identifier: Apache-2.0
import { Readable } from "node:stream";
import {
  consumeProjectArchiveArtifact,
} from "@web/lib/project-archive-artifacts.server.js";
import type { ExportArtifactLookup } from "@web/lib/export-artifacts.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

export interface ProjectArchiveArtifactRouteDependencies {
  consumeArtifact?: (token: string) => Promise<ExportArtifactLookup>;
}

function unavailable(status: 404 | 410): Response {
  return jsonError(status, status === 410 ? "Project archive expired" : "Project archive not found");
}

export async function handleProjectArchiveArtifactGet(
  token: string,
  dependencies: ProjectArchiveArtifactRouteDependencies = {},
): Promise<Response> {
  const lookup = await (dependencies.consumeArtifact ?? consumeProjectArchiveArtifact)(token);
  if (lookup.status === "expired") return unavailable(410);
  if (lookup.status !== "ready") return unavailable(404);
  const { artifact } = lookup;
  void artifact.cleanup.catch(() => undefined);
  try {
    return new Response(Readable.toWeb(artifact.stream) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${artifact.filename}"`,
        "content-length": artifact.size.toString(),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    await artifact.dispose();
    throw error;
  }
}
