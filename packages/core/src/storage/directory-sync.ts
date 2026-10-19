// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";

export type DirectoryHandle = Pick<FileHandle, "sync" | "close">;

/** Persists a directory entry change where the filesystem allows directory fsync. */
export async function syncDirectoryBestEffort(
  directory: string,
  openDirectory: (path: string) => Promise<DirectoryHandle> = (path) => open(path, constants.O_RDONLY),
): Promise<void> {
  let handle: DirectoryHandle | undefined;
  try {
    handle = await openDirectory(directory);
    await handle.sync();
  } catch {
    // Some supported local filesystems do not permit directory fsync.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
