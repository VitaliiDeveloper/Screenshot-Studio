// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isProjectRelativePath } from "@screenshot-studio/core/model";
import { readIdentifiedProjectSnapshot, resolveExistingProjectPath } from "@screenshot-studio/core/storage";
import {
  publishFileSafelyWithOwnership,
  removeFileWithDeterministicQuarantine,
  type SafeFileOwnership,
} from "./safe-file-publisher.js";

export type CaptureImportIntentPhase = "prepared" | "resources-published" | "project-committed";

export interface CaptureImportIntentResource {
  relativePath: string;
  digest: string;
  stageToken: string;
  stageRelativePath: string;
  destinationCleanupRelativePath: string;
  stageCleanupRelativePath: string;
  ownership?: { device: string; inode: string; revision: string };
  created?: boolean;
}

export interface CaptureImportIntent {
  version: 1;
  operation: "capture-import";
  projectPath: string;
  projectDevice: string;
  projectInode: string;
  initialRevision: string;
  expectedRevision: string;
  phase: CaptureImportIntentPhase;
  resources: CaptureImportIntentResource[];
}

interface ReadIntent {
  intent: CaptureImportIntent;
  ownership: SafeFileOwnership;
}

function noFollowReadFlags(): number {
  return constants.O_RDONLY
    | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function directorySyncUnsupported(error: unknown): boolean {
  return ["EBADF", "EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(errorCode(error) ?? "");
}

async function syncDirectoryDurably(
  path: string,
  openDirectory: (path: string) => Promise<Pick<FileHandle, "sync" | "close">> = (
    directory,
  ) => open(directory, constants.O_RDONLY),
): Promise<void> {
  let handle: Pick<FileHandle, "sync" | "close"> | undefined;
  try {
    handle = await openDirectory(path);
    await handle.sync();
  } catch (error) {
    if (!directorySyncUnsupported(error)) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function expectedStageRelativePath(relativePath: string, token: string): string {
  const segments = relativePath.split("/");
  const stageName = `.${segments.at(-1)!}.${token}.capture-stage`;
  return [...segments.slice(0, -1), stageName].join("/");
}

function strictKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseOwnership(value: unknown): CaptureImportIntentResource["ownership"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Invalid capture import recovery ownership");
  const record = value as Record<string, unknown>;
  if (!strictKeys(record, ["device", "inode", "revision"])
    || typeof record.device !== "string" || !/^\d+$/u.test(record.device)
    || typeof record.inode !== "string" || !/^\d+$/u.test(record.inode)
    || typeof record.revision !== "string" || !/^[0-9a-f]{64}$/u.test(record.revision)) {
    throw new TypeError("Invalid capture import recovery ownership");
  }
  return { device: record.device, inode: record.inode, revision: record.revision };
}

function parseIntent(value: unknown): CaptureImportIntent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Invalid capture import recovery intent");
  const record = value as Record<string, unknown>;
  if (!strictKeys(record, [
    "version", "operation", "projectPath", "projectDevice", "projectInode",
    "initialRevision", "expectedRevision", "phase", "resources",
  ]) || record.version !== 1 || record.operation !== "capture-import"
    || typeof record.projectPath !== "string"
    || typeof record.projectDevice !== "string" || !/^\d+$/u.test(record.projectDevice)
    || typeof record.projectInode !== "string" || !/^\d+$/u.test(record.projectInode)
    || typeof record.initialRevision !== "string" || !/^[0-9a-f]{64}$/u.test(record.initialRevision)
    || typeof record.expectedRevision !== "string" || !/^[0-9a-f]{64}$/u.test(record.expectedRevision)
    || !["prepared", "resources-published", "project-committed"].includes(String(record.phase))
    || !Array.isArray(record.resources)) {
    throw new TypeError("Invalid capture import recovery intent");
  }
  const resources = record.resources.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new TypeError("Invalid capture import recovery resource");
    const resource = entry as Record<string, unknown>;
    const keys = [
      "relativePath", "digest", "stageToken", "stageRelativePath",
      "destinationCleanupRelativePath", "stageCleanupRelativePath",
    ];
    if ("ownership" in resource) keys.push("ownership");
    if ("created" in resource) keys.push("created");
    if (!strictKeys(resource, keys)
      || typeof resource.relativePath !== "string"
      || typeof resource.digest !== "string" || !/^[0-9a-f]{64}$/u.test(resource.digest)
      || typeof resource.stageToken !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(resource.stageToken)
      || typeof resource.stageRelativePath !== "string"
      || typeof resource.destinationCleanupRelativePath !== "string"
      || typeof resource.stageCleanupRelativePath !== "string"
      || ("created" in resource && typeof resource.created !== "boolean")) {
      throw new TypeError("Invalid capture import recovery resource");
    }
    const created = resource.created as boolean | undefined;
    const parsedOwnership = resource.ownership === undefined
      ? undefined
      : parseOwnership(resource.ownership);
    if (!isProjectRelativePath(resource.relativePath)
      || !isProjectRelativePath(resource.stageRelativePath)
      || !isProjectRelativePath(resource.destinationCleanupRelativePath)
      || !isProjectRelativePath(resource.stageCleanupRelativePath)
      || resource.stageRelativePath !== expectedStageRelativePath(resource.relativePath, resource.stageToken)
      || resource.destinationCleanupRelativePath !== `${resource.stageRelativePath}.destination-cleanup`
      || resource.stageCleanupRelativePath !== `${resource.stageRelativePath}.cleanup`
      || (parsedOwnership === undefined) !== (created === undefined)
      || (parsedOwnership !== undefined && parsedOwnership.revision !== resource.digest)) {
      throw new TypeError("Invalid capture import recovery resource relationship");
    }
    return {
      relativePath: resource.relativePath,
      digest: resource.digest,
      stageToken: resource.stageToken,
      stageRelativePath: resource.stageRelativePath,
      destinationCleanupRelativePath: resource.destinationCleanupRelativePath,
      stageCleanupRelativePath: resource.stageCleanupRelativePath,
      ...(parsedOwnership === undefined ? {} : { ownership: parsedOwnership }),
      ...(created === undefined ? {} : { created }),
    };
  });
  const allPaths = new Set<string>();
  for (const resource of resources) {
    for (const path of [
      resource.relativePath,
      resource.stageRelativePath,
      resource.destinationCleanupRelativePath,
      resource.stageCleanupRelativePath,
    ]) {
      const key = path.normalize("NFC").toLowerCase();
      if (allPaths.has(key)) throw new TypeError("Invalid duplicate capture import recovery resource");
      allPaths.add(key);
    }
  }
  if (record.phase !== "prepared" && resources.some((resource) => resource.ownership === undefined)) {
    throw new TypeError("Invalid incomplete capture import recovery phase");
  }
  return {
    version: 1,
    operation: "capture-import",
    projectPath: record.projectPath,
    projectDevice: record.projectDevice,
    projectInode: record.projectInode,
    initialRevision: record.initialRevision,
    expectedRevision: record.expectedRevision,
    phase: record.phase as CaptureImportIntentPhase,
    resources,
  };
}

export function captureImportIntentPath(projectPath: string): string {
  return join(dirname(projectPath), `.${basename(projectPath)}.capture-import.intent.json`);
}

function intentRelativePath(projectPath: string): string {
  return basename(captureImportIntentPath(projectPath));
}

async function readIntentFile(path: string): Promise<ReadIntent> {
  const named = await lstat(path, { bigint: true });
  if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n) {
    throw new Error("Capture import recovery required: intent is not an exclusive regular file");
  }
  const handle = await open(path, noFollowReadFlags());
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(named, opened) || opened.nlink !== 1n) {
      throw new Error("Capture import recovery required: intent identity changed");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(opened, after) || opened.size !== after.size || opened.mtimeNs !== after.mtimeNs) {
      throw new Error("Capture import recovery required: intent changed while read");
    }
    return {
      intent: parseIntent(JSON.parse(bytes.toString("utf8"))),
      ownership: {
        device: opened.dev,
        inode: opened.ino,
        revision: createHash("sha256").update(bytes).digest("hex"),
      },
    };
  } finally {
    await handle.close();
  }
}

async function readIntent(projectPath: string): Promise<ReadIntent | null> {
  const path = captureImportIntentPath(projectPath);
  const cleanupPath = `${path}.cleanup`;
  const [primaryExists, cleanupExists] = await Promise.all([
    pathExists(path),
    pathExists(cleanupPath),
  ]);
  if (primaryExists && cleanupExists) {
    throw new Error("Capture import recovery required: intent and cleanup both exist");
  }
  if (primaryExists) return readIntentFile(path);
  if (cleanupExists) return readIntentFile(cleanupPath);
  return null;
}

export async function writeCaptureImportIntent(
  intent: CaptureImportIntent,
  dependencies: {
    syncDirectory?: (path: string) => Promise<void>;
    openDirectory?: (path: string) => Promise<Pick<FileHandle, "sync" | "close">>;
  } = {},
): Promise<SafeFileOwnership> {
  const bytes = new TextEncoder().encode(`${JSON.stringify(parseIntent(intent), null, 2)}\n`);
  const publication = await publishFileSafelyWithOwnership({
    root: dirname(intent.projectPath),
    relativePath: intentRelativePath(intent.projectPath),
    bytes,
    replace: true,
  });
  const syncDirectory = dependencies.syncDirectory
    ?? ((path: string) => syncDirectoryDurably(path, dependencies.openDirectory));
  await syncDirectory(dirname(intent.projectPath));
  return publication.ownership;
}

function ownership(value: NonNullable<CaptureImportIntentResource["ownership"]>): SafeFileOwnership {
  return { device: BigInt(value.device), inode: BigInt(value.inode), revision: value.revision };
}

async function removeIntent(projectPath: string, evidence: SafeFileOwnership): Promise<void> {
  const relativePath = intentRelativePath(projectPath);
  const removed = await removeFileWithDeterministicQuarantine(
    dirname(projectPath),
    relativePath,
    `${relativePath}.cleanup`,
    evidence,
  );
  if (!removed) throw new Error("Capture import recovery required: intent disappeared before cleanup");
  await syncDirectoryDurably(dirname(projectPath));
}

export async function reconcileCaptureImport(
  projectPath: string,
  dependencies: {
    afterResourceQuarantine?: (path: string) => void | Promise<void>;
  } = {},
): Promise<void> {
  const canonicalPath = await resolveExistingProjectPath(projectPath);
  const currentIntent = await readIntent(canonicalPath);
  if (!currentIntent) return;
  const { intent, ownership: intentOwnership } = currentIntent;
  if (intent.projectPath !== canonicalPath) {
    throw new Error("Capture import recovery required: intent belongs to another Project");
  }
  const snapshot = await readIdentifiedProjectSnapshot(canonicalPath);
  if (snapshot.revision === intent.expectedRevision) {
    await removeIntent(canonicalPath, intentOwnership);
    return;
  }
  if (snapshot.identity.device.toString() !== intent.projectDevice
    || snapshot.identity.inode.toString() !== intent.projectInode) {
    throw new Error("Capture import recovery required: Project identity changed");
  }
  if (snapshot.revision !== intent.initialRevision) {
    throw new Error("Capture import recovery required: Project revision is ambiguous");
  }
  const root = dirname(canonicalPath);
  for (const resource of [...intent.resources].reverse()) {
    const destinationPath = join(root, ...resource.relativePath.split("/"));
    const stagePath = join(root, ...resource.stageRelativePath.split("/"));
    const stageCleanupPath = join(root, ...resource.stageCleanupRelativePath.split("/"));
    if (!resource.ownership) {
      if (await pathExists(stagePath) || await pathExists(stageCleanupPath)) {
        throw new Error("Capture import recovery required: prepared stage lacks ownership evidence");
      }
      continue;
    }
    if (resource.created === false) {
      if (await pathExists(stagePath) || await pathExists(stageCleanupPath)) {
        throw new Error("Capture import recovery required: unowned stage appeared for an existing resource");
      }
      continue;
    }
    const destinationRemoved = await removeFileWithDeterministicQuarantine(
      root,
      resource.relativePath,
      resource.destinationCleanupRelativePath,
      ownership(resource.ownership),
      { afterQuarantine: dependencies.afterResourceQuarantine },
    );
    if (!destinationRemoved && await pathExists(destinationPath)) {
      throw new Error("Capture import recovery required: destination ownership changed");
    }
    const stageRemoved = await removeFileWithDeterministicQuarantine(
      root,
      resource.stageRelativePath,
      resource.stageCleanupRelativePath,
      ownership(resource.ownership),
      { afterQuarantine: dependencies.afterResourceQuarantine },
    );
    if (!stageRemoved && await pathExists(stagePath)) {
      throw new Error("Capture import recovery required: stage ownership changed");
    }
  }
  await removeIntent(canonicalPath, intentOwnership);
}
