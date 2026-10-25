// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import {
  applyCaptureImportPlan,
  assertCaptureImportConfirmation,
  assertCaptureImportNotCancelled,
  planCaptureImport,
  withCaptureImportInvalidEntries,
  type CaptureImportDiscovery,
  type CaptureImportIssue,
  type CaptureImportMode,
  type CaptureImportPlan,
} from "@screenshot-studio/core/capture-import";
import type { Project } from "@screenshot-studio/core/model";
import type { StoreSpecs } from "@screenshot-studio/core/export";
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
  CAPTURE_IMPORT_INTENT_OPERATION,
  CAPTURE_IMPORT_INTENT_VERSION,
  captureImportRecoveryResourcePaths,
  captureImportIntentPath,
  reconcileCaptureImport,
  writeCaptureImportIntent,
  type CaptureImportIntent,
} from "./capture-import-recovery.js";
import {
  inspectFilePublicationDestination,
  prepareFilePublication,
  SafeFileConflictError,
  type PreparedPublicationDependencies,
} from "./safe-file-publisher.js";

export { SafeFileConflictError };

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

function ownershipStrings(ownership: { device: bigint; inode: bigint; revision: string }) {
  return {
    device: ownership.device.toString(),
    inode: ownership.inode.toString(),
    revision: ownership.revision,
  };
}

export async function preflightCaptureImportPlanResources(
  projectPath: string,
  plan: CaptureImportPlan,
): Promise<CaptureImportPlan> {
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const root = dirname(canonicalPath);
  const conflicts: CaptureImportIssue[] = [];
  for (const resource of plan.resources) {
    let state: Awaited<ReturnType<typeof inspectFilePublicationDestination>>;
    try {
      state = await inspectFilePublicationDestination({
        root,
        relativePath: resource.destinationPath,
        bytes: resource.bytes,
      });
    } catch {
      state = "conflicting";
    }
    if (state === "conflicting") {
      conflicts.push({
        code: "destination-conflict",
        path: resource.destinationPath,
        message: `Receiver resource already exists with different bytes: ${resource.destinationPath}`,
      });
    }
  }
  return withCaptureImportInvalidEntries(plan, conflicts);
}

export async function applyCaptureImportToProject(input: {
  projectPath: string;
  expectedRevision?: string;
  discovery: CaptureImportDiscovery;
  layoutId: string;
  mode?: CaptureImportMode;
  confirmationFingerprint?: string;
  signal?: AbortSignal;
  specs?: StoreSpecs;
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
    assertCaptureImportNotCancelled(input.signal);
    const current = await readIdentifiedProjectSnapshot(canonicalPath, dependencies.fileDependencies);
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
      throw new ProjectRevisionConflictError(input.expectedRevision, current.revision);
    }
    const plan = await preflightCaptureImportPlanResources(canonicalPath, planCaptureImport({
      project: current.project,
      layoutId: input.layoutId,
      destinationKind: "current-project",
      discovery: input.discovery,
      mode: input.mode,
      specs: input.specs,
    }));
    if (input.confirmationFingerprint !== undefined) {
      assertCaptureImportConfirmation(plan, input.confirmationFingerprint);
    }
    const applied = applyCaptureImportPlan(current.project, plan);
    const expectedRevision = projectRevision(serializeProject(applied.project));
    const intent: CaptureImportIntent = {
      version: CAPTURE_IMPORT_INTENT_VERSION,
      operation: CAPTURE_IMPORT_INTENT_OPERATION,
      projectPath: canonicalPath,
      projectDevice: current.identity.device.toString(),
      projectInode: current.identity.inode.toString(),
      initialRevision: current.revision,
      expectedRevision,
      phase: "prepared",
      resources: applied.resources.map((resource) => {
        const token = randomId();
        return {
          relativePath: resource.destinationPath,
          digest: resource.digest,
          stageToken: token,
          ...captureImportRecoveryResourcePaths(resource.destinationPath, token),
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
        assertCaptureImportNotCancelled(input.signal);
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
      assertCaptureImportNotCancelled(input.signal);
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
