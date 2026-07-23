// SPDX-License-Identifier: Apache-2.0
import { constants, type BigIntStats, type Dirent } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  discoverCaptureImport,
  planCaptureImport,
  resolveCaptureImportLimits,
  type CaptureImportDiscovery,
  type CaptureImportInputFile,
  type CaptureImportLimits,
  type CaptureImportPlan,
} from "@screenshot-studio/core/capture-import";
import { resolveExistingProjectPath, type ProjectFileDependencies } from "@screenshot-studio/core/storage";
import {
  applyCaptureImportToProject,
  preflightCaptureImportPlanResources,
} from "./capture-import-transaction.js";
import { loadProjectSnapshot } from "./project-io.js";
import { resolveMutationLayout } from "./layout-commands.js";

export interface ImportCapturesOptions {
  projectPath: string;
  inputDir: string;
  layout?: string;
}

export interface ImportCapturesResult {
  imported: number;
  warnings: string[];
}

interface ImportCapturesDependencies {
  projectFileDependencies?: ProjectFileDependencies;
}

function hasSameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function noFollowReadFlags(): number {
  return constants.O_RDONLY
    | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

async function readRegularInputFile(
  canonicalRoot: string,
  path: string,
  namedBefore: BigIntStats,
): Promise<Uint8Array> {
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink()) {
    throw new Error(`Capture import input must be a regular file: ${path}`);
  }
  if (namedBefore.nlink !== 1n) {
    throw new Error(`Capture import input must not be a hard link: ${path}`);
  }
  assertContained(canonicalRoot, await realpath(path));
  const handle = await open(path, noFollowReadFlags());
  try {
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || openedBefore.nlink !== 1n
      || !hasSameIdentity(namedBefore, openedBefore)
      || namedBefore.size !== openedBefore.size
      || namedBefore.mtimeNs !== openedBefore.mtimeNs
      || namedBefore.ctimeNs !== openedBefore.ctimeNs) {
      throw new Error(`Capture import input changed before it was opened: ${path}`);
    }
    const bytes = await handle.readFile();
    const [openedAfter, namedAfter, canonicalAfter] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
      realpath(path),
    ]);
    assertContained(canonicalRoot, canonicalAfter);
    if (!openedAfter.isFile() || openedAfter.nlink !== 1n
      || !hasSameIdentity(openedBefore, openedAfter)
      || !hasSameIdentity(openedAfter, namedAfter)
      || openedBefore.size !== openedAfter.size
      || openedBefore.mtimeNs !== openedAfter.mtimeNs
      || openedBefore.ctimeNs !== openedAfter.ctimeNs) {
      throw new Error(`Capture import input changed while it was read: ${path}`);
    }
    return new Uint8Array(bytes);
  } finally {
    await handle.close();
  }
}

function assertContained(root: string, path: string): void {
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Capture import input escaped its root: ${path}`);
  }
}

function comparePortable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function listDirectoryEntries(
  directory: string,
  limits: CaptureImportLimits,
  state: { totalBytes: number; totalEntries: number },
): Promise<Dirent[]> {
  const entries: Dirent[] = [];
  for await (const entry of await opendir(directory)) {
    state.totalEntries += 1;
    if (state.totalEntries > limits.maxEntries) {
      throw new Error("Capture import exceeds the configured entry limit");
    }
    entries.push(entry);
  }
  return entries.sort((left, right) => comparePortable(left.name, right.name));
}

async function collectTree(
  canonicalRoot: string,
  directory: string,
  prefix: string,
  files: CaptureImportInputFile[],
  limits: CaptureImportLimits,
  state: { totalBytes: number; totalEntries: number },
  knownEntries?: Dirent[],
): Promise<void> {
  const [directoryInfo, canonicalDirectory] = await Promise.all([
    lstat(directory),
    realpath(directory),
  ]);
  assertContained(canonicalRoot, canonicalDirectory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error(`Capture import input contains a symbolic link or non-directory: ${directory}`);
  }
  const entries = knownEntries ?? await listDirectoryEntries(directory, limits, state);
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (new TextEncoder().encode(relativePath).byteLength > limits.maxPathBytes) {
      throw new Error(`Capture import input exceeds the configured path limit: ${relativePath}`);
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`Capture import input contains a symbolic link: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      await collectTree(canonicalRoot, path, relativePath, files, limits, state);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Capture import input contains a non-regular entry: ${relativePath}`);
    }
    if (files.length >= limits.maxFiles) {
      throw new Error("Capture import exceeds the configured file limit");
    }
    const namedBefore = await lstat(path, { bigint: true });
    const remainingBytes = limits.maxBytes - state.totalBytes;
    if (namedBefore.size > BigInt(remainingBytes)) {
      throw new Error("Capture import exceeds the configured byte limit");
    }
    const bytes = await readRegularInputFile(canonicalRoot, path, namedBefore);
    if (bytes.byteLength > remainingBytes) {
      throw new Error("Capture import exceeds the configured byte limit");
    }
    state.totalBytes += bytes.byteLength;
    files.push({ relativePath, bytes });
  }
}

export async function collectCaptureImportDirectory(
  inputDir: string,
  inputLimits?: Partial<CaptureImportLimits>,
): Promise<CaptureImportInputFile[]> {
  const limits = resolveCaptureImportLimits(inputLimits);
  const requestedRoot = resolve(inputDir);
  const rootInfo = await lstat(requestedRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Capture import root must be a real directory, not a symbolic link");
  }
  const canonicalRoot = await realpath(requestedRoot);
  const state = { totalBytes: 0, totalEntries: 0 };
  const rootEntries = await listDirectoryEntries(canonicalRoot, limits, state);
  const screenshots = rootEntries.find((entry) => entry.name === "screenshots");
  const files: CaptureImportInputFile[] = [];
  if (screenshots?.isDirectory() && !screenshots.isSymbolicLink()) {
    await collectTree(
      canonicalRoot,
      join(canonicalRoot, "screenshots"),
      "screenshots",
      files,
      limits,
      state,
    );
    const assets = rootEntries.find((entry) => entry.name === "assets");
    if (assets?.isSymbolicLink()) {
      throw new Error("Capture import input contains a symbolic link: assets");
    }
    if (assets?.isDirectory()) {
      await collectTree(canonicalRoot, join(canonicalRoot, "assets"), "assets", files, limits, state);
    }
  } else {
    await collectTree(canonicalRoot, canonicalRoot, "", files, limits, state, rootEntries);
  }
  return files;
}

async function captureDiscovery(inputDir: string): Promise<CaptureImportDiscovery> {
  return discoverCaptureImport({ files: await collectCaptureImportDirectory(inputDir) });
}

export async function previewCaptures({
  projectPath,
  inputDir,
  layout: layoutReference,
}: ImportCapturesOptions): Promise<CaptureImportPlan> {
  const canonicalProjectPath = await resolveExistingProjectPath(projectPath);
  const [{ project }, discovery] = await Promise.all([
    loadProjectSnapshot(canonicalProjectPath),
    captureDiscovery(inputDir),
  ]);
  const layoutId = resolveMutationLayout(project, layoutReference).id;
  return preflightCaptureImportPlanResources(canonicalProjectPath, planCaptureImport({
    project,
    layoutId,
    destinationKind: "current-project",
    discovery,
  }));
}

export async function importCaptures({
  projectPath,
  inputDir,
  layout: layoutReference,
}: ImportCapturesOptions, {
  projectFileDependencies = {},
}: ImportCapturesDependencies = {}): Promise<ImportCapturesResult> {
  const canonicalProjectPath = await resolveExistingProjectPath(projectPath);
  const discovery = await captureDiscovery(inputDir);
  const warnings = discovery.warnings.map(({ message }) => message);
  if (discovery.captures.length === 0 && discovery.invalidEntries.length === 0) {
    return { imported: 0, warnings };
  }
  const { project } = await loadProjectSnapshot(canonicalProjectPath);
  const layoutId = resolveMutationLayout(project, layoutReference).id;
  const applied = await applyCaptureImportToProject({
    projectPath: canonicalProjectPath,
    discovery,
    layoutId,
  }, { fileDependencies: projectFileDependencies });
  return { imported: applied.imported, warnings };
}
