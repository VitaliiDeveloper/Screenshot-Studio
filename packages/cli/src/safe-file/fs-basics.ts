// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { constants, type BigIntStats, type Stats } from "node:fs";
import { lstat } from "node:fs/promises";
import { errorText, noFollowFlags } from "@screenshot-studio/core/storage";

export function errorWithCleanup(primary: unknown, cleanup: unknown): AggregateError {
  return new AggregateError(
    [primary, cleanup],
    `${errorText(primary)}; stage cleanup failed: ${errorText(cleanup)}`,
    { cause: primary },
  );
}
export function hasCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === code;
}
export async function lstatIfExists(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}
export async function lstatBigIntIfExists(path: string): Promise<BigIntStats | null> {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}
export function publicationDestinationError(path: string, stats: Stats): Error {
  if (stats.isSymbolicLink()) {
    return new Error(`Unsafe symbolic link at publication destination: ${path}`);
  }
  return new Error(`Publication destination must be a regular file: ${path}`);
}
export function removalTargetError(path: string, stats: Stats): Error {
  if (stats.isSymbolicLink()) {
    return new Error(`Unsafe symbolic link at safe removal target: ${path}`);
  }
  return new Error(`Safe removal target must be a regular file: ${path}`);
}
export function verificationFlags(): number {
  return noFollowFlags(constants.O_RDONLY)
    | (typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0);
}
export function contentRevision(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
