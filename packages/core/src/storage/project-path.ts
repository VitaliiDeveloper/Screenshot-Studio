// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, readdir, realpath, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { withOptionalNoFollow } from "./open-flags.js";

export class ProjectPathError extends Error {
  override name = "ProjectPathError";
}

export interface ProjectPathIdentity {
  device: bigint;
  inode: bigint;
}

export interface ProjectPublicationEvidence {
  identity: ProjectPathIdentity;
  revision: string;
  links: bigint;
}

export interface ProjectCreationIntent {
  version: 1;
  token: string;
  projectFile: string;
  stageFile: string;
  revision: string;
  identity: {
    device: string;
    inode: string;
  };
}

interface ProjectFileEvidence extends ProjectPublicationEvidence {
  bytes: Buffer;
  stats: BigIntStats;
}

interface ReadableEvidenceHandle {
  stat(options: { bigint: true }): Promise<BigIntStats>;
  readFile(): Promise<Buffer>;
  close(): Promise<void>;
}

export interface ProjectPublicationDependencies {
  openFile?: (path: string, flags: number) => Promise<ReadableEvidenceHandle>;
}

interface ParsedCreationIntent {
  intent: ProjectCreationIntent;
  identity: ProjectPathIdentity;
}

interface CreationIntentCandidate extends ParsedCreationIntent {
  path: string;
  evidence: ProjectFileEvidence;
}

const UUID_V4_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const UUID_V4_PATTERN = new RegExp(`^${UUID_V4_SOURCE}$`, "i");
const REVISION_PATTERN = /^[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function identityOf(stats: BigIntStats): ProjectPathIdentity {
  return { device: stats.dev, inode: stats.ino };
}

function identitiesMatch(left: ProjectPathIdentity, right: ProjectPathIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function evidenceMatches(
  evidence: ProjectPublicationEvidence,
  expected: ProjectPublicationEvidence,
): boolean {
  return identitiesMatch(evidence.identity, expected.identity)
    && evidence.revision === expected.revision;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function intentEntryPattern(projectPath: string): RegExp {
  return new RegExp(
    `^\\.${escapeRegExp(basename(projectPath))}\\.(${UUID_V4_SOURCE})\\.create-intent\\.json$`,
    "i",
  );
}

export function isProjectCreationToken(token: string): boolean {
  return UUID_V4_PATTERN.test(token);
}

export function projectCreationStagePath(projectPath: string, token: string): string {
  return join(dirname(projectPath), `.${basename(projectPath)}.${token}.tmp`);
}

export function projectCreationIntentPath(projectPath: string, token: string): string {
  return join(dirname(projectPath), `.${basename(projectPath)}.${token}.create-intent.json`);
}

export function createProjectCreationIntent(
  projectPath: string,
  token: string,
  revision: string,
  identity: ProjectPathIdentity,
): ProjectCreationIntent {
  return {
    version: 1,
    token,
    projectFile: basename(projectPath),
    stageFile: basename(projectCreationStagePath(projectPath, token)),
    revision,
    identity: {
      device: identity.device.toString(),
      inode: identity.inode.toString(),
    },
  };
}

export function serializeProjectCreationIntent(intent: ProjectCreationIntent): string {
  return `${JSON.stringify(intent)}\n`;
}

function noFollowReadFlags(): number {
  return withOptionalNoFollow(
    constants.O_RDONLY | constants.O_NONBLOCK,
    constants.O_NOFOLLOW,
  );
}

async function lstatIfExists(path: string): Promise<BigIntStats | null> {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

async function readFileEvidence(
  path: string,
  dependencies: ProjectPublicationDependencies = {},
): Promise<ProjectFileEvidence | null> {
  const openFile = dependencies.openFile ?? open;
  let handle: ReadableEvidenceHandle;
  try {
    handle = await openFile(path, noFollowReadFlags());
  } catch (error) {
    if (
      errorCode(error) === "ENOENT"
      || errorCode(error) === "ELOOP"
      || errorCode(error) === "EMLINK"
    ) return null;
    throw new ProjectPathError(
      `Unable to inspect project publication file ${path}: ${errorText(error)}`,
      { cause: error },
    );
  }

  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) return null;
    const named = await lstatIfExists(path);
    if (!named?.isFile() || !identitiesMatch(identityOf(named), identityOf(stats))) return null;
    const bytes = await handle.readFile();
    return {
      bytes,
      stats,
      identity: identityOf(stats),
      revision: createHash("sha256").update(bytes).digest("hex"),
      links: stats.nlink,
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function inspectProjectPublicationFile(
  path: string,
  dependencies: ProjectPublicationDependencies = {},
): Promise<ProjectPublicationEvidence> {
  const evidence = await readFileEvidence(path, dependencies);
  if (!evidence) {
    throw new ProjectPathError(`Project publication file must be a no-follow regular file: ${path}`);
  }
  return {
    identity: evidence.identity,
    revision: evidence.revision,
    links: evidence.links,
  };
}

export async function projectPublicationFileMatches(
  path: string,
  expected: ProjectPublicationEvidence,
): Promise<boolean> {
  const evidence = await readFileEvidence(path);
  if (!evidence || !evidenceMatches(evidence, expected)) return false;
  const named = await lstatIfExists(path);
  return named?.isFile() === true && identitiesMatch(identityOf(named), expected.identity);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function parseCreationIntent(
  bytes: Buffer,
  projectPath: string,
  filenameToken: string,
): ParsedCreationIntent | null {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasExactKeys(
    value,
    ["version", "token", "projectFile", "stageFile", "revision", "identity"],
  )) return null;
  if (!isRecord(value.identity) || !hasExactKeys(value.identity, ["device", "inode"])) return null;
  if (
    value.version !== 1
    || typeof value.token !== "string"
    || value.token !== filenameToken
    || !isProjectCreationToken(value.token)
    || value.projectFile !== basename(projectPath)
    || value.stageFile !== basename(projectCreationStagePath(projectPath, value.token))
    || typeof value.revision !== "string"
    || !REVISION_PATTERN.test(value.revision)
    || typeof value.identity.device !== "string"
    || !DECIMAL_PATTERN.test(value.identity.device)
    || typeof value.identity.inode !== "string"
    || !DECIMAL_PATTERN.test(value.identity.inode)
  ) return null;

  const intent = value as unknown as ProjectCreationIntent;
  return {
    intent,
    identity: {
      device: BigInt(intent.identity.device),
      inode: BigInt(intent.identity.inode),
    },
  };
}

async function readCreationIntentCandidate(
  projectPath: string,
  entry: string,
  token: string,
): Promise<CreationIntentCandidate | null> {
  const path = join(dirname(projectPath), entry);
  const evidence = await readFileEvidence(path);
  if (!evidence || evidence.links !== 1n) return null;
  const parsed = parseCreationIntent(evidence.bytes, projectPath, token);
  if (!parsed) return null;
  return { path, evidence, ...parsed };
}

async function removeTrackedPublicationFile(
  path: string,
  expected: ProjectPublicationEvidence,
): Promise<boolean> {
  if (!(await projectPublicationFileMatches(path, expected))) return false;
  try {
    // unlink does not follow a replacement symlink. Node has no portable unlinkat-by-handle, so a
    // final namespace revalidation window remains part of the documented local-filesystem boundary.
    await unlink(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw new ProjectPathError(
      `Unable to remove tracked project publication file ${path}: ${errorText(error)}`,
      { cause: error },
    );
  }
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, constants.O_RDONLY);
    await handle.sync();
  } catch {
    // Some supported local filesystems do not permit directory fsync.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function assertProjectEvidence(
  projectPath: string,
  evidence: ProjectFileEvidence | null,
  expectedIdentity?: ProjectPathIdentity,
): asserts evidence is ProjectFileEvidence {
  if (!evidence) {
    throw new ProjectPathError(`Project path must remain a no-follow regular file: ${projectPath}`);
  }
  if (expectedIdentity && !identitiesMatch(evidence.identity, expectedIdentity)) {
    throw new ProjectPathError(`Project path identity changed during creation recovery: ${projectPath}`);
  }
}

function intentMatchesProject(
  candidate: CreationIntentCandidate,
  project: ProjectFileEvidence,
): boolean {
  return candidate.intent.revision === project.revision
    && identitiesMatch(candidate.identity, project.identity);
}

function stageMatchesIntent(
  stage: ProjectFileEvidence,
  candidate: CreationIntentCandidate,
  project: ProjectFileEvidence,
): boolean {
  return stage.links === 2n
    && stage.revision === candidate.intent.revision
    && evidenceMatches(stage, project)
    && identitiesMatch(stage.identity, candidate.identity);
}

export async function recoverOwnedProjectStages(
  projectPath: string,
  expectedIdentity?: ProjectPathIdentity,
): Promise<BigIntStats> {
  let project = await readFileEvidence(projectPath);
  assertProjectEvidence(projectPath, project, expectedIdentity);
  const originalIdentity = project.identity;
  const directory = dirname(projectPath);
  const pattern = intentEntryPattern(projectPath);
  let removed = false;

  for (const entry of await readdir(directory)) {
    const match = pattern.exec(entry);
    if (!match) continue;
    const candidate = await readCreationIntentCandidate(projectPath, entry, match[1]!);
    if (!candidate) continue;

    project = await readFileEvidence(projectPath);
    assertProjectEvidence(projectPath, project, originalIdentity);
    if (!intentMatchesProject(candidate, project)) continue;
    const stagePath = join(directory, candidate.intent.stageFile);
    const stageEntry = await lstatIfExists(stagePath);

    if (project.links === 1n) {
      if (stageEntry === null) {
        removed = await removeTrackedPublicationFile(candidate.path, candidate.evidence) || removed;
      }
      continue;
    }

    if (project.links !== 2n) continue;
    const stage = await readFileEvidence(stagePath);
    if (!stage || !stageMatchesIntent(stage, candidate, project)) continue;

    project = await readFileEvidence(projectPath);
    assertProjectEvidence(projectPath, project, originalIdentity);
    if (!intentMatchesProject(candidate, project) || project.links !== 2n) continue;
    if (!(await removeTrackedPublicationFile(stagePath, stage))) continue;
    removed = true;

    project = await readFileEvidence(projectPath);
    assertProjectEvidence(projectPath, project, originalIdentity);
    if (project.links !== 1n || !intentMatchesProject(candidate, project)) continue;
    removed = await removeTrackedPublicationFile(candidate.path, candidate.evidence) || removed;
  }

  if (removed) await syncDirectoryBestEffort(directory);
  project = await readFileEvidence(projectPath);
  assertProjectEvidence(projectPath, project, originalIdentity);
  return project.stats;
}

export async function resolveExistingProjectPath(projectPath: string): Promise<string> {
  const absolutePath = resolve(projectPath);
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(absolutePath);
  } catch (error) {
    throw new ProjectPathError(
      `Unable to resolve existing project path ${absolutePath}: ${errorText(error)}`,
      { cause: error },
    );
  }

  let entry: BigIntStats;
  try {
    entry = await recoverOwnedProjectStages(canonicalPath);
  } catch (error) {
    if (error instanceof ProjectPathError) throw error;
    throw new ProjectPathError(
      `Unable to inspect existing project path ${canonicalPath}: ${errorText(error)}`,
      { cause: error },
    );
  }

  if (entry.nlink > 1n) {
    throw new ProjectPathError(
      `Project file has ${entry.nlink} hard links and cannot have one lock identity: ${canonicalPath}. `
      + "Copy it to a new file before opening it",
    );
  }
  return canonicalPath;
}
