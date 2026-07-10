// SPDX-License-Identifier: Apache-2.0
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { parseProjectJson, type Project } from "../model/index.js";

/**
 * Storage boundary (docs/architecture.md §2). `core` depends on this interface, not a concrete
 * store, so the community can add browser FS / IndexedDB adapters without touching the engine.
 */
export interface StorageAdapter {
  load(projectId: string): Promise<Project>;
  save(project: Project, projectId: string): Promise<void>;
  putAsset(bytes: Uint8Array): Promise<{ url: string; hash: string }>;
}

/**
 * Reference adapter: reads/writes the project JSON and assets on local disk, like the
 * self-hosted product. `projectId` is a filesystem path to the project JSON file.
 */
export class LocalFileStorageAdapter implements StorageAdapter {
  constructor(private readonly assetsDir: string) {}

  async load(projectId: string): Promise<Project> {
    const json = await readFile(projectId, "utf8");
    return parseProjectJson(json);
  }

  async save(project: Project, projectId: string): Promise<void> {
    await mkdir(dirname(projectId), { recursive: true });
    await writeFile(projectId, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  }

  async putAsset(bytes: Uint8Array): Promise<{ url: string; hash: string }> {
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const path = join(this.assetsDir, hash);
    await mkdir(this.assetsDir, { recursive: true });
    await writeFile(path, bytes);
    return { url: path, hash };
  }
}
