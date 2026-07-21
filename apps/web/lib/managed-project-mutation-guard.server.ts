// SPDX-License-Identifier: Apache-2.0
import { realpath } from "node:fs/promises";
import { join } from "node:path";
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
import type { ProjectSession } from "./project-session.server.js";

export interface ManagedProjectMutationGuardDependencies {
  config?: ManagedProjectStorageConfig;
  lockOptions?: ManagedProjectLifecycleLockOptions;
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
      throw new Error("Managed project lifecycle changed; reload it before continuing");
    }
    const expectedPath = await realpath(join(config.projectsRoot, session.projectId, "app-store-screenshots.json"));
    const sessionPath = await realpath(session.projectPath);
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
