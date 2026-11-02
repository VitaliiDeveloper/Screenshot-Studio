// SPDX-License-Identifier: Apache-2.0
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { errorCode } from "@screenshot-studio/core/storage";
import { ManagedProjectCatalogStore } from "./managed-project-catalog.server.js";
import {
  withManagedProjectLifecycleLock,
  type ManagedProjectLifecycleLock,
  type ManagedProjectLifecycleLockOptions,
} from "./managed-project-lifecycle-lock.server.js";
import {
  resolveManagedProjectStorageConfig,
  type ManagedProjectStorageConfig,
} from "./managed-project-config.server.js";
import type { ProjectSession } from "@web/lib/session/project-session.server.js";

export interface ManagedProjectMutationGuardDependencies {
  config?: ManagedProjectStorageConfig;
  lockOptions?: ManagedProjectLifecycleLockOptions;
}

export class ManagedProjectLifecycleChangedError extends Error {
  constructor(options?: ErrorOptions) {
    super("Managed project lifecycle changed; reload it before continuing", options);
    this.name = "ManagedProjectLifecycleChangedError";
  }
}

async function managedFileRealpath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") throw new ManagedProjectLifecycleChangedError({ cause: error });
    throw error;
  }
}

async function withManagedProjectLifecycleGuard<T>(
  session: ProjectSession,
  operation: (lock?: ManagedProjectLifecycleLock) => Promise<T>,
  dependencies: ManagedProjectMutationGuardDependencies = {},
): Promise<T> {
  if (session.descriptor.sourceKind !== "managed-project") return operation();
  const expectedLifecycleRevision = session.descriptor.lifecycleRevision;
  if (!Number.isSafeInteger(expectedLifecycleRevision) || expectedLifecycleRevision! <= 0) {
    throw new Error("Managed project session is missing its lifecycle revision");
  }
  const config = dependencies.config ?? resolveManagedProjectStorageConfig();
  return withManagedProjectLifecycleLock(
    config,
    session.projectId,
    async (lock) => {
    const entry = await new ManagedProjectCatalogStore(config).getActive(session.projectId);
    if (!entry || entry.lifecycleRevision !== expectedLifecycleRevision) {
      throw new ManagedProjectLifecycleChangedError();
    }
    const expectedPath = await managedFileRealpath(join(config.projectsRoot, session.projectId, "app-store-screenshots.json"));
    const sessionPath = await managedFileRealpath(session.projectPath);
    if (sessionPath !== expectedPath) throw new Error("Managed project session path is outside managed storage");
      return operation(lock);
    },
    dependencies.lockOptions,
  );
}

export function withManagedProjectReadGuard<T>(
  session: ProjectSession,
  operation: (lock?: ManagedProjectLifecycleLock) => Promise<T>,
  dependencies: ManagedProjectMutationGuardDependencies = {},
): Promise<T> {
  return withManagedProjectLifecycleGuard(session, operation, dependencies);
}

export function withManagedProjectMutationGuard<T>(
  session: ProjectSession,
  operation: () => Promise<T>,
  dependencies: ManagedProjectMutationGuardDependencies = {},
): Promise<T> {
  return withManagedProjectLifecycleGuard(session, operation, dependencies);
}
