// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { dirname, posix } from "node:path";
import {
  applyCaptureImportPlan,
  planCaptureImport,
  type CaptureImportDiscovery,
  type CaptureImportPlan,
} from "@screenshot-studio/core/capture-import";
import type { Project } from "@screenshot-studio/core/model";
import {
  ProjectRevisionConflictError,
  projectRevision,
  readIdentifiedProjectSnapshot,
  resolveExistingProjectPath,
  serializeProject,
  withProjectMutation,
  writeProjectConditionalAtomic,
  type ProjectFileDependencies,
  type ProjectLockOptions,
} from "@screenshot-studio/core/storage";
import {
  captureImportIntentPath,
  reconcileCaptureImport,
  writeCaptureImportIntent,
  type CaptureImportIntent,
} from "./capture-import-recovery.js";
import {
  prepareFilePublication,
  type PreparedPublicationDependencies,
} from "./safe-file-publisher.js";

export type CaptureImportDurabilityBoundary =
  | "intent-prepared"
  | "stage-created"
  | "stage-evidence"
  | "resource-committed"
  | "resources-published"
  | "project-committed"
  | "committed-intent"
  | "intent-removed";

export class CaptureImportCrashSimulation extends Error {
  override name = "CaptureImportCrashSimulation";
  constructor(readonly boundary: CaptureImportDurabilityBoundary) {
    super(`Simulated capture import crash after ${boundary}`);
  }
}

export interface CaptureImportTransactionDependencies {
  randomId?: () => string;
  fileDependencies?: ProjectFileDependencies;
  lockOptions?: ProjectLockOptions;
  preparedPublicationDependencies?: PreparedPublicationDependencies;
  intentSyncDirectory?: (path: string) => Promise<void>;
  intentOpenDirectory?: (
    path: string,
  ) => Promise<{ sync(): Promise<void>; close(): Promise<void> }>;
  boundary?: (
    boundary: CaptureImportDurabilityBoundary,
    context: { intentPath: string; stagePath?: string; resourcePath?: string },
  ) => void | Promise<void>;
}

export interface ApplyCaptureImportResult {
  imported: number;
  project: Project;
  revision: string;
  plan: CaptureImportPlan;
}

function stageRelativePath(relativePath: string, token: string): string {
  const directory = posix.dirname(relativePath);
  const name = `.${posix.basename(relativePath)}.${token}.capture-stage`;
  return directory === "." ? name : posix.join(directory, name);
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Capture import was cancelled");
}

function ownershipStrings(ownership: { device: bigint; inode: bigint; revision: string }) {
  return {
    device: ownership.device.toString(),
    inode: ownership.inode.toString(),
    revision: ownership.revision,
  };
}

export async function applyCaptureImportToProject(input: {
  projectPath: string;
  expectedRevision?: string;
  discovery: CaptureImportDiscovery;
  layoutId: string;
  signal?: AbortSignal;
}, dependencies: CaptureImportTransactionDependencies = {}): Promise<ApplyCaptureImportResult> {
  const canonicalPath = await resolveExistingProjectPath(input.projectPath);
  const root = dirname(canonicalPath);
  const randomId = dependencies.randomId ?? (() => randomUUID().replaceAll("-", ""));
  const intentPath = captureImportIntentPath(canonicalPath);
  const boundary = async (
    name: CaptureImportDurabilityBoundary,
    context: { stagePath?: string; resourcePath?: string } = {},
  ) => dependencies.boundary?.(name, { intentPath, ...context });

  return withProjectMutation(canonicalPath, async () => {
    await reconcileCaptureImport(canonicalPath);
    throwIfCancelled(input.signal);
    const current = await readIdentifiedProjectSnapshot(canonicalPath, dependencies.fileDependencies);
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
      throw new ProjectRevisionConflictError(input.expectedRevision, current.revision);
    }
    const plan = planCaptureImport({
      project: current.project,
      layoutId: input.layoutId,
      destinationKind: "current-project",
      discovery: input.discovery,
    });
    const applied = applyCaptureImportPlan(current.project, plan);
    const expectedRevision = projectRevision(serializeProject(applied.project));
    const intent: CaptureImportIntent = {
      version: 1,
      operation: "capture-import",
      projectPath: canonicalPath,
      projectDevice: current.identity.device.toString(),
      projectInode: current.identity.inode.toString(),
      initialRevision: current.revision,
      expectedRevision,
      phase: "prepared",
      resources: applied.resources.map((resource) => {
        const token = randomId();
        const preparedStagePath = stageRelativePath(resource.destinationPath, token);
        return {
          relativePath: resource.destinationPath,
          digest: resource.digest,
          stageToken: token,
          stageRelativePath: preparedStagePath,
          destinationCleanupRelativePath: `${preparedStagePath}.destination-cleanup`,
          stageCleanupRelativePath: `${preparedStagePath}.cleanup`,
        };
      }),
    };
    try {
      const intentPersistence = {
        syncDirectory: dependencies.intentSyncDirectory,
        openDirectory: dependencies.intentOpenDirectory,
      };
      await writeCaptureImportIntent(intent, intentPersistence);
      await boundary("intent-prepared");
      for (let index = 0; index < applied.resources.length; index += 1) {
        throwIfCancelled(input.signal);
        const resource = applied.resources[index]!;
        const intentResource = intent.resources[index]!;
        const prepared = await prepareFilePublication({
          root,
          relativePath: resource.destinationPath,
          bytes: resource.bytes,
          stageToken: intentResource.stageToken,
        }, dependencies.preparedPublicationDependencies);
        if (prepared.stagePath) {
          await boundary("stage-created", {
            stagePath: prepared.stagePath,
            resourcePath: resource.destinationPath,
          });
        }
        intentResource.ownership = ownershipStrings(prepared.ownership);
        intentResource.created = prepared.created;
        await writeCaptureImportIntent(intent, intentPersistence);
        await boundary("stage-evidence", {
          ...(prepared.stagePath ? { stagePath: prepared.stagePath } : {}),
          resourcePath: resource.destinationPath,
        });
        const publication = await prepared.commit();
        intentResource.ownership = ownershipStrings(publication.ownership);
        intentResource.created = publication.created;
        await writeCaptureImportIntent(intent, intentPersistence);
        await boundary("resource-committed", { resourcePath: resource.destinationPath });
      }
      intent.phase = "resources-published";
      await writeCaptureImportIntent(intent, intentPersistence);
      await boundary("resources-published");
      throwIfCancelled(input.signal);
      const persisted = await writeProjectConditionalAtomic(
        canonicalPath,
        applied.project,
        current,
        dependencies.fileDependencies,
      );
      await boundary("project-committed");
      intent.phase = "project-committed";
      await writeCaptureImportIntent(intent, intentPersistence);
      await boundary("committed-intent");
      await reconcileCaptureImport(canonicalPath);
      await boundary("intent-removed");
      return {
        imported: plan.screens.length,
        project: persisted.project,
        revision: persisted.revision,
        plan,
      };
    } catch (error) {
      if (error instanceof CaptureImportCrashSimulation) throw error;
      try {
        await reconcileCaptureImport(canonicalPath);
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          `${error instanceof Error ? error.message : String(error)}; capture import recovery required`,
          { cause: recoveryError },
        );
      }
      throw error;
    }
  }, dependencies.lockOptions);
}
