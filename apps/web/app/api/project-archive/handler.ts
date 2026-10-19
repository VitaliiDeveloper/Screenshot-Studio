// SPDX-License-Identifier: Apache-2.0
import { ManagedProjectArchiveService } from "@web/lib/managed-projects/managed-project-archive.server.js";
import {
  resolveManagedProjectStorageConfig,
  type ManagedProjectStorageConfig,
} from "@web/lib/managed-projects/managed-project-config.server.js";
import { ManagedProjectRepository } from "@web/lib/managed-projects/managed-project-repository.server.js";
import {
  stageProjectArchiveArtifact,
  type ProjectArchiveArtifactTicket,
} from "@web/lib/project-archive-artifacts.server.js";
import {
  withProjectVersionedReadRequest,
  type ProjectReadRequestDependencies,
} from "@web/lib/session/project-request-fence.server.js";
import {
  type ActiveProjectResolverDependencies,
} from "@web/lib/session/project-session.server.js";
import type { ManagedProjectLifecycleLock } from "@web/lib/managed-projects/managed-project-lifecycle-lock.server.js";
import { jsonError } from "@web/lib/api-error-response.server.js";

type CreatedArchive = Awaited<ReturnType<ManagedProjectArchiveService["create"]>>;

export interface ProjectArchiveRouteDependencies {
  session?: ActiveProjectResolverDependencies;
  managedStorageConfig?: ManagedProjectStorageConfig;
  managedReadGuard?: ProjectReadRequestDependencies["managedReadGuard"];
  createArchive?: (
    projectId: string,
    lifecycleLock?: ManagedProjectLifecycleLock,
  ) => Promise<CreatedArchive>;
  stageArtifact?: (path: string) => Promise<ProjectArchiveArtifactTicket>;
}

export async function handleProjectArchivePost(
  request: Request,
  dependencies: ProjectArchiveRouteDependencies = {},
): Promise<Response> {
  const managedStorageConfig = dependencies.managedStorageConfig
    ?? resolveManagedProjectStorageConfig();
  return withProjectVersionedReadRequest(request, async (session, expectedRevision, lifecycleLock) => {
    if (session.descriptor.sourceKind !== "managed-project") {
      return jsonError(409, "Project archive export is available only for managed projects", "managed-project-required");
    }
    const createArchive = dependencies.createArchive ?? ((projectId, heldLock) => (
      new ManagedProjectArchiveService(
        new ManagedProjectRepository(managedStorageConfig),
      ).create(projectId, heldLock)
    ));
    const stageArtifact = dependencies.stageArtifact ?? stageProjectArchiveArtifact;
    let archive: CreatedArchive | undefined;
    let operationError: unknown;
    let revisionMismatch = false;
    let ticket: ProjectArchiveArtifactTicket | undefined;
    try {
      archive = await createArchive(session.projectId, lifecycleLock);
      revisionMismatch = archive.projectRevision !== expectedRevision;
      if (!revisionMismatch) ticket = await stageArtifact(archive.path);
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
      return jsonError(500, "Project archive export failed", "archive-failed");
    }
    if (revisionMismatch) {
      return jsonError(412, "Project changed before the archive could be staged", "project-revision-changed");
    }
    return Response.json({ ...ticket!, projectRevision: archive!.projectRevision }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  }, {
    ...dependencies.session,
    managedStorageConfig,
    managedReadGuard: dependencies.managedReadGuard,
  });
}
