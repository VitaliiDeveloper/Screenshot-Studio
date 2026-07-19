// SPDX-License-Identifier: Apache-2.0
import type { TrashedManagedProjectCatalogEntry } from "./managed-project-catalog.server.js";
import {
  resolveManagedProjectStorageConfig,
  type ManagedProjectStorageConfig,
} from "./managed-project-config.server.js";
import { ManagedProjectRepository } from "./managed-project-repository.server.js";
import {
  projectSessionRegistry,
  type ProjectSessionRegistry,
} from "./project-session.server.js";

export class ManagedProjectLifecycleService {
  readonly repository: ManagedProjectRepository;

  constructor(
    config: ManagedProjectStorageConfig = resolveManagedProjectStorageConfig(),
    registry: ProjectSessionRegistry = projectSessionRegistry,
  ) {
    this.repository = new ManagedProjectRepository(config, {
      onTrashed: (id) => { registry.invalidateManagedProject(id); },
    });
  }

  moveToTrash(
    id: string,
    expectedLifecycleRevision: number,
  ): Promise<TrashedManagedProjectCatalogEntry> {
    return this.repository.moveToTrash(id, expectedLifecycleRevision);
  }
}
