// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { lstat, unlink, type FileHandle } from "node:fs/promises";
import { noFollowFlags } from "@screenshot-studio/core/storage";

export interface ArtifactIdentity {
  device: bigint;
  inode: bigint;
  size: bigint;
}

interface ArtifactStat {
  dev: bigint;
  ino: bigint;
  size: bigint;
  nlink: bigint;
  isFile(): boolean;
}

export function readFlags(): number {
  return noFollowFlags(constants.O_RDONLY | constants.O_NONBLOCK);
}

export function writeFlags(): number {
  return noFollowFlags(constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
}

export function asArtifactStat(value: unknown): ArtifactStat {
  return value as ArtifactStat;
}

export function identityOf(stat: ArtifactStat): ArtifactIdentity {
  return { device: stat.dev, inode: stat.ino, size: stat.size };
}

export function sameIdentity(left: ArtifactIdentity, right: ArtifactIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.size === right.size;
}

function sameBinding(left: ArtifactIdentity, right: ArtifactIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

export function isExpectedArtifact(stat: ArtifactStat, identity: ArtifactIdentity): boolean {
  return stat.isFile() && stat.nlink === 1n && sameIdentity(identityOf(stat), identity);
}

export async function unlinkExpectedArtifact(
  path: string,
  identity: ArtifactIdentity,
  unlinkFile: (path: string) => Promise<void> = unlink,
): Promise<void> {
  try {
    const current = asArtifactStat(await lstat(path, { bigint: true }));
    if (current.isFile() && sameBinding(identityOf(current), identity)) await unlinkFile(path);
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

export async function closeHandles(
  handles: FileHandle[],
  primaryError: { value: unknown } | null,
): Promise<void> {
  const closeResults = await Promise.allSettled(handles.map((handle) => handle.close()));
  const closeErrors = closeResults.flatMap((result) => (
    result.status === "rejected" ? [result.reason] : []
  ));
  if (primaryError !== null) {
    if (closeErrors.length > 0) {
      throw new AggregateError([primaryError.value, ...closeErrors], "Artifact staging and cleanup failed", {
        cause: primaryError.value,
      });
    }
    throw primaryError.value;
  }
  if (closeErrors.length === 1) throw closeErrors[0];
  if (closeErrors.length > 1) throw new AggregateError(closeErrors, "Artifact handle cleanup failed");
}

export async function copyFileHandles(source: FileHandle, destination: FileHandle): Promise<void> {
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (true) {
    const { bytesRead } = await source.read(buffer, 0, buffer.byteLength, position);
    if (bytesRead === 0) return;
    let written = 0;
    while (written < bytesRead) {
      const result = await destination.write(
        buffer,
        written,
        bytesRead - written,
        position + written,
      );
      if (result.bytesWritten === 0) throw new Error("Export artifact staging made no write progress");
      written += result.bytesWritten;
    }
    position += bytesRead;
  }
}
