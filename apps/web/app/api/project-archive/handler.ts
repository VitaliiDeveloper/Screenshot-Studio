// SPDX-License-Identifier: Apache-2.0
import { ManagedProjectArchiveService } from "@web/lib/managed-project-archive.server.js";
import { resolveManagedProjectStorageConfig } from "@web/lib/managed-project-config.server.js";
import { ManagedProjectRepository } from "@web/lib/managed-project-repository.server.js";
import {
  stageProjectArchiveArtifact,
  type ProjectArchiveArtifactTicket,
} from "@web/lib/project-archive-artifacts.server.js";
import {
  withActiveProjectSession,
  type ActiveProjectResolverDependencies,
} from "@web/lib/project-session.server.js";

type CreatedArchive = Awaited<ReturnType<ManagedProjectArchiveService["create"]>>;

export interface ProjectArchiveRouteDependencies {
  session?: ActiveProjectResolverDependencies;
  createArchive?: (projectId: string) => Promise<CreatedArchive>;
  stageArtifact?: (path: string) => Promise<ProjectArchiveArtifactTicket>;
}

export async function handleProjectArchivePost(
  request: Request,
  dependencies: ProjectArchiveRouteDependencies = {},
): Promise<Response> {
  return withActiveProjectSession(request, async (session) => {
    if (session.descriptor.sourceKind !== "managed-project") {
      return Response.json({
        error: "Project archive export is available only for managed projects",
        code: "managed-project-required",
      }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    const createArchive = dependencies.createArchive ?? ((projectId) => (
      new ManagedProjectArchiveService(
        new ManagedProjectRepository(resolveManagedProjectStorageConfig()),
      ).create(projectId)
    ));
    const stageArtifact = dependencies.stageArtifact ?? stageProjectArchiveArtifact;
    let archive: CreatedArchive | undefined;
    let operationError: unknown;
    let ticket: ProjectArchiveArtifactTicket | undefined;
    try {
      archive = await createArchive(session.projectId);
      ticket = await stageArtifact(archive.path);
    } catch (error) {
      operationError = error;
    }
    if (archive) {
      try {
        await archive.dispose();
      } catch (cleanupError) {
        operationError = operationError === undefined
          ? cleanupError
          : new AggregateError(
              [operationError, cleanupError],
              "Project archive staging and temporary-file cleanup both failed",
              { cause: operationError },
            );
      }
    }
    if (operationError !== undefined) {
      return Response.json({
        error: "Project archive export failed",
        code: "archive-failed",
      }, { status: 500, headers: { "cache-control": "no-store" } });
    }
    return Response.json(ticket!, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  }, dependencies.session);
}
