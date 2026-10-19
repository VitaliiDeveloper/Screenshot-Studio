// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { noFollowFlags, syncDirectoryBestEffort } from "@screenshot-studio/core/storage";

export interface PrivateJsonDocumentWrite {
  root: string;
  targetPath: string;
  /** Stage file name prefix: the stage is `<root>/<stagePrefix>.<uuid>.stage`. */
  stagePrefix: string;
  label: string;
  contents: string;
  openFile: (path: string, flags: number, mode: number) => Promise<FileHandle>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  writeStage?: (handle: FileHandle, contents: string) => Promise<void>;
}

/**
 * Replaces an app-private JSON document atomically: an exclusive no-follow `0600` sibling stage
 * is written and synced, then renamed over the target. A failed write removes only its own stage.
 */
export async function writePrivateJsonDocument({
  root,
  targetPath,
  stagePrefix,
  label,
  contents,
  openFile,
  rename,
  writeStage = (handle, stageContents) => handle.writeFile(stageContents, "utf8"),
}: PrivateJsonDocumentWrite): Promise<void> {
  const stagePath = join(root, `${stagePrefix}.${randomUUID()}.stage`);
  let handle: FileHandle | undefined;
  let ownsStage = false;
  try {
    handle = await openFile(
      stagePath,
      noFollowFlags(constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY),
      0o600,
    );
    ownsStage = true;
    await writeStage(handle, contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(stagePath, targetPath);
    ownsStage = false;
    await syncDirectoryBestEffort(root);
  } catch (error) {
    let primaryError = error;
    if (handle) {
      try { await handle.close(); } catch (closeError) {
        primaryError = new AggregateError([primaryError, closeError], `${label} stage close failed`, {
          cause: closeError,
        });
      }
    }
    if (ownsStage) {
      try { await rm(stagePath, { force: true }); } catch (cleanupError) {
        throw new AggregateError([primaryError, cleanupError], `${label} stage cleanup failed`, {
          cause: cleanupError,
        });
      }
    }
    throw primaryError;
  }
}
