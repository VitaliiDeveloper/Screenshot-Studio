// SPDX-License-Identifier: Apache-2.0
// Shared fixtures for the safe file publication tests.
import { execFile } from "node:child_process";
import { mkdtemp, readdir, realpath, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  publishFileSafely,
  quarantineRegularFileSafely,
  removeRegularFileSafely,
  type SafeFilePublication,
  type SafeRegularFileQuarantine,
} from "../safe-file-publisher.js";

const temporaryRoots: string[] = [];
export const execFileAsync = promisify(execFile);

export async function cleanupTemporaryRoots(): Promise<void> {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export async function workspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export type StageHandle = Pick<FileHandle, "writeFile" | "sync" | "close">
  & Partial<Pick<FileHandle, "stat">>;
export type VerificationHandle = Pick<FileHandle, "stat" | "read" | "readFile" | "close">;

export interface TestPublicationDependencies {
  randomId?: () => string;
  openStage?: (path: string, flags: number, mode: number) => Promise<StageHandle>;
  openVerification?: (path: string, flags: number) => Promise<VerificationHandle>;
  linkFile?: (source: string, destination: string) => Promise<void>;
  moveFile?: (source: string, destination: string) => Promise<void>;
  quarantineFile?: (source: string, destination: string) => Promise<void>;
  restoreLink?: (source: string, destination: string) => Promise<void>;
  removeStage?: (path: string) => Promise<void>;
  beforePublication?: (context: {
    destinationPath: string;
    stagePath: string;
    mode: "create-only" | "replace";
  }) => Promise<void>;
}

export interface TestRemovalDependencies {
  openVerification?: (path: string, flags: number) => Promise<VerificationHandle>;
  quarantineFile?: (source: string, destination: string) => Promise<void>;
  restoreLink?: (source: string, destination: string) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
}

export type TestQuarantineDependencies = TestRemovalDependencies;

export const publishWithDependencies = publishFileSafely as unknown as (
  options: SafeFilePublication,
  dependencies?: TestPublicationDependencies,
) => Promise<{ path: string; created: boolean }>;

export const removeWithDependencies = removeRegularFileSafely as unknown as (
  root: string,
  relativePath: string,
  expected?: { device: bigint; inode: bigint; revision: string },
  dependencies?: TestRemovalDependencies,
) => Promise<boolean>;

export const quarantineWithDependencies = quarantineRegularFileSafely as unknown as (
  root: string,
  relativePath: string,
  expected?: { device: bigint; inode: bigint; revision: string },
  dependencies?: TestQuarantineDependencies,
) => Promise<SafeRegularFileQuarantine | null>;

export async function stageEntries(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.startsWith(".") && name.endsWith(".tmp"));
}

export async function canonicalDestination(root: string, relativePath: string): Promise<string> {
  return join(await realpath(root), relativePath);
}
