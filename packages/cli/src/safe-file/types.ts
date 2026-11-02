// SPDX-License-Identifier: Apache-2.0
import { type FileHandle } from "node:fs/promises";

export interface SafeFilePublication {
  root: string;
  relativePath: string;
  bytes: Uint8Array;
  replace?: boolean;
}
export interface SafeFileOwnership {
  device: bigint;
  inode: bigint;
  revision: string;
}
export interface SafeFilePublicationWithOwnership {
  path: string;
  created: boolean;
  ownership: SafeFileOwnership;
}
export interface PreparedSafeFilePublication {
  path: string;
  stagePath: string | null;
  created: boolean;
  ownership: SafeFileOwnership;
  commit(): Promise<SafeFilePublicationWithOwnership>;
  discard(): Promise<void>;
}
export interface PreparedPublicationDependencies {
  linkFile?: (source: string, destination: string) => Promise<void>;
  syncDirectory?: (directory: string) => Promise<void>;
  openDirectory?: (directory: string) => Promise<Pick<FileHandle, "sync" | "close">>;
  openVerification?: (path: string, flags: number) => Promise<VerificationHandle>;
}
export interface PublicationInspectionDependencies {
  openVerification?: (path: string, flags: number) => Promise<InspectionHandle>;
}
export type FilePublicationDestinationState = "missing" | "matching" | "conflicting";
export interface DeterministicRemovalDependencies {
  linkFile?: (source: string, destination: string) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
  syncDirectory?: (directory: string) => Promise<void>;
  afterQuarantine?: (quarantinePath: string) => void | Promise<void>;
}
export interface SafeRegularFileQuarantine {
  path: string;
  recoveryPath: string;
  bytes: Uint8Array;
  ownership: SafeFileOwnership;
  restore(): Promise<void>;
  discard(): Promise<void>;
}
export class SafeFileConflictError extends Error {
  override name = "SafeFileConflictError";
  readonly code = "SAFE_FILE_CONFLICT" as const;

  constructor(
    readonly path: string,
    message = `Publication destination already exists with different bytes: ${path}`,
  ) {
    super(message);
  }
}
export type StageHandle = Pick<FileHandle, "writeFile" | "sync" | "close">
  & Partial<Pick<FileHandle, "stat">>;
export type VerificationHandle = Pick<FileHandle, "stat" | "read" | "readFile" | "close">;
export type InspectionHandle = Pick<FileHandle, "stat" | "read" | "close">;
export type StageIdentity = SafeFileOwnership;
export interface TrackedFileEvidence extends StageIdentity {
  links: bigint;
  bytes: Buffer;
}
export interface PublicationDependencies {
  randomId?: () => string;
  openStage?: (path: string, flags: number, mode: number) => Promise<StageHandle>;
  openVerification?: (path: string, flags: number) => Promise<VerificationHandle>;
  linkFile?: (source: string, destination: string) => Promise<void>;
  moveFile?: (source: string, destination: string) => Promise<void>;
  quarantineFile?: (source: string, destination: string) => Promise<void>;
  restoreLink?: (source: string, destination: string) => Promise<void>;
  removeStage?: (path: string) => Promise<void>;
  captureOwnership?: (ownership: SafeFileOwnership) => void;
  beforePublication?: (context: {
    destinationPath: string;
    stagePath: string;
    mode: "create-only" | "replace";
  }) => Promise<void>;
}
export interface RemovalDependencies {
  openVerification?: (path: string, flags: number) => Promise<VerificationHandle>;
  quarantineFile?: (source: string, destination: string) => Promise<void>;
  restoreLink?: (source: string, destination: string) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
}
export interface RootBoundary {
  requestedRoot: string;
  canonicalRoot: string;
}
export interface RootCreationPlan {
  requestedRoot: string;
  anchor: RootBoundary;
  missingSegments: string[];
}
export interface CapturedError {
  value: unknown;
}
export interface QuarantineOutcome {
  captured: boolean;
  error: CapturedError | null;
}
