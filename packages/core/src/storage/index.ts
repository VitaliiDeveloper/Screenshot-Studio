// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseProjectJson, type Project } from "@screenshot-studio/core/model";
import { writeProjectAtomic } from "./project-file.js";

export {
  createProjectAtomic,
  ProjectRevisionConflictError,
  projectRevision,
  readIdentifiedProjectSnapshot,
  readProjectSnapshot,
  serializeProject,
  writeProjectConditionalAtomic,
  writeProjectAtomic,
  type IdentifiedProjectSnapshot,
  type ProjectFileDependencies,
  type ProjectFileIdentity,
  type ProjectSnapshot,
} from "./project-file.js";
export {
  acquireProjectMutationLock,
  projectMutationLockPath,
  withProjectMutation,
  type ProjectLockOptions,
  type ProjectMutationLock,
} from "./project-lock.js";
export {
  ProjectPathError,
  resolveExistingProjectPath,
} from "./project-path.js";

/**
 * Storage boundary (docs/architecture.md). `core` depends on this interface, not a concrete
 * store, so the community can add browser FS / IndexedDB adapters without touching the engine.
 */
export interface StorageAdapter {
  load(projectId: string): Promise<Project>;
  save(project: Project, projectId: string): Promise<void>;
  putAsset(bytes: Uint8Array): Promise<{ url: string; hash: string }>;
}

/**
 * Reference adapter for project JSON plus content-addressed asset writes on local disk.
 * `projectId` is a filesystem path to the project JSON file; other project resource trees use
 * their dedicated services.
 */
export class LocalFileStorageAdapter implements StorageAdapter {
  constructor(private readonly assetsDir: string) {}

  async load(projectId: string): Promise<Project> {
    const json = await readFile(projectId, "utf8");
    return parseProjectJson(json);
  }

  async save(project: Project, projectId: string): Promise<void> {
    await writeProjectAtomic(projectId, project);
  }

  async putAsset(bytes: Uint8Array): Promise<{ url: string; hash: string }> {
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const path = join(this.assetsDir, hash);
    await mkdir(this.assetsDir, { recursive: true });
    await writeFile(path, bytes);
    return { url: path, hash };
  }
}
