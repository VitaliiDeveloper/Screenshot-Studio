// SPDX-License-Identifier: Apache-2.0
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { errorCode, readProjectSnapshot } from "@screenshot-studio/core/storage";
import type { ManagedProjectStorageConfig } from "./managed-project-config.server.js";

const PROJECT_FILE = "app-store-screenshots.json";

export async function readManagedProjectTree(
  directory: string,
  config: ManagedProjectStorageConfig,
): Promise<Awaited<ReturnType<typeof readProjectSnapshot>>> {
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("Managed project must be a real directory");
  }
  const projectPath = join(directory, PROJECT_FILE);
  const rootFile = await lstat(projectPath);
  if (!rootFile.isFile()) throw new Error(`Managed project requires a root ${PROJECT_FILE}`);
  let entries = 0;
  let bytes = 0;
  const walk = async (current: string): Promise<void> => {
    // A concurrent writer's lock entry can vanish between listing and inspection.
    const names = await readdir(current).catch((error: unknown) => {
      if (current !== directory && errorCode(error) === "ENOENT") return [];
      throw error;
    });
    for (const name of names) {
      const path = join(current, name);
      const info = await lstat(path).catch((error: unknown) => {
        if (errorCode(error) === "ENOENT") return undefined;
        throw error;
      });
      if (!info) continue;
      entries += 1;
      if (entries > config.maxProjectFiles) throw new Error("Managed project exceeds the configured file limit");
      if (info.isSymbolicLink()) throw new Error("Managed project cannot contain a symbolic link");
      if (info.isDirectory()) { await walk(path); continue; }
      if (!info.isFile()) throw new Error("Managed project can contain only regular files and directories");
      if (info.nlink !== 1) throw new Error("Managed project cannot contain a hard link");
      bytes += info.size;
      if (bytes > config.maxProjectBytes) throw new Error("Managed project exceeds the configured byte limit");
    }
  };
  await walk(directory);
  return readProjectSnapshot(projectPath);
}
