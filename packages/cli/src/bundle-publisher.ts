// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import JSZip from "jszip";
import type { BundleEntry } from "@screenshot-studio/core/export";

export interface RenderedBundleEntry {
  entry: BundleEntry;
  png: Buffer;
}

const DETERMINISTIC_ZIP_DATE = new Date("2000-01-01T00:00:00.000Z");

function resolveSafeBundleOutputPath(outDir: string, relativePath: string): string {
  const segments = relativePath.split("/");
  if (
    isAbsolute(relativePath)
    || relativePath.includes("\\")
    || relativePath.includes("\0")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe bundle output path "${relativePath}"`);
  }
  const root = resolve(outDir);
  const outputPath = resolve(root, relativePath);
  const fromRoot = relative(root, outputPath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Unsafe bundle output path "${relativePath}"`);
  }
  return outputPath;
}

async function lstatIfExists(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertDirectoryNotSymlink(path: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (stats.isSymbolicLink()) throw new Error(`Unsafe symbolic link in bundle output path "${path}"`);
  if (!stats.isDirectory()) throw new Error(`Bundle output ancestor is not a directory "${path}"`);
}

async function preflightOutputSymlinks(outDir: string, outputPath: string): Promise<void> {
  const root = resolve(outDir);
  const rootStats = await lstatIfExists(root);
  if (rootStats) assertDirectoryNotSymlink(root, rootStats);

  const directory = dirname(outputPath);
  const relativeDirectory = relative(root, directory);
  let current = root;
  for (const segment of relativeDirectory === "" ? [] : relativeDirectory.split(sep)) {
    current = join(current, segment);
    const stats = await lstatIfExists(current);
    if (!stats) break;
    assertDirectoryNotSymlink(current, stats);
  }

  const outputStats = await lstatIfExists(outputPath);
  if (outputStats?.isSymbolicLink()) {
    throw new Error(`Unsafe symbolic link at bundle output file "${outputPath}"`);
  }
  if (outputStats?.isDirectory()) {
    throw new Error(`Bundle output file is an existing directory "${outputPath}"`);
  }
}

async function ensureSafeOutputDirectory(outDir: string, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const root = resolve(outDir);
  const relativeDirectory = relative(root, directory);
  let current = root;
  for (const segment of ["", ...(relativeDirectory === "" ? [] : relativeDirectory.split(sep))]) {
    if (segment) current = join(current, segment);
    const stats = await lstat(current);
    assertDirectoryNotSymlink(current, stats);
  }
}

async function writeFileNoFollow(path: string, bytes: Buffer): Promise<void> {
  const flags = constants.O_WRONLY
    | constants.O_CREAT
    | constants.O_TRUNC
    | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(path, flags, 0o666);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

interface BundleOutputDependencies {
  makeTempDirectory?: typeof mkdtemp;
  move?: typeof rename;
  remove?: typeof rm;
  write?: typeof writeFileNoFollow;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withSecondaryError(primary: unknown, secondary: unknown, action: string): AggregateError {
  return new AggregateError(
    [primary, secondary],
    `${errorMessage(primary)}; ${action}: ${errorMessage(secondary)}`,
    { cause: primary },
  );
}

export async function writeBundleOutputs({
  outDir,
  entries,
  dependencies = {},
}: {
  outDir: string;
  entries: RenderedBundleEntry[];
  dependencies?: BundleOutputDependencies;
}): Promise<string> {
  const makeTempDirectory = dependencies.makeTempDirectory ?? mkdtemp;
  const move = dependencies.move ?? rename;
  const remove = dependencies.remove ?? rm;
  const write = dependencies.write ?? writeFileNoFollow;
  const seenPaths = new Set<string>();
  const outputs = entries.map(({ entry, png }) => {
    const outputPath = resolveSafeBundleOutputPath(outDir, entry.relativePath);
    const collisionKey = entry.relativePath.normalize("NFC").toLowerCase();
    if (seenPaths.has(collisionKey)) {
      throw new Error(`Duplicate bundle output path "${entry.relativePath}"`);
    }
    seenPaths.add(collisionKey);
    return { entry, png, outputPath };
  });
  const zipPath = join(outDir, "app-store-screenshots-bundle.zip");
  for (const { outputPath } of outputs) {
    await preflightOutputSymlinks(outDir, outputPath);
  }
  await preflightOutputSymlinks(outDir, zipPath);

  const zip = new JSZip();
  await ensureSafeOutputDirectory(outDir, outDir);
  for (const { entry, png } of outputs) {
    zip.file(entry.relativePath, png, {
      createFolders: false,
      date: DETERMINISTIC_ZIP_DATE,
    });
  }
  const zipBytes = await zip.generateAsync({ type: "nodebuffer" });

  const stagingRoot = await makeTempDirectory(join(resolve(outDir), ".screenshot-studio-stage-"));
  const stagedFilesRoot = join(stagingRoot, "files");
  const backupRoot = join(stagingRoot, "backup");
  const publications = [
    ...outputs.map(({ entry, png, outputPath }) => ({
      relativePath: entry.relativePath,
      bytes: png,
      outputPath,
    })),
    {
      relativePath: "app-store-screenshots-bundle.zip",
      bytes: zipBytes,
      outputPath: zipPath,
    },
  ];

  let primaryError: unknown;
  let preserveStagingForRecovery = false;
  try {
    for (const publication of publications) {
      const stagedPath = resolveSafeBundleOutputPath(stagedFilesRoot, publication.relativePath);
      await mkdir(dirname(stagedPath), { recursive: true });
      await write(stagedPath, publication.bytes);
    }

    const applied: Array<{
      outputPath: string;
      backupPath: string;
      backupMoved: boolean;
      published: boolean;
    }> = [];
    try {
      for (const [index, publication] of publications.entries()) {
        await preflightOutputSymlinks(outDir, publication.outputPath);
        await ensureSafeOutputDirectory(outDir, dirname(publication.outputPath));
        const stagedPath = resolveSafeBundleOutputPath(stagedFilesRoot, publication.relativePath);
        const backupPath = join(backupRoot, String(index));
        const state = { outputPath: publication.outputPath, backupPath, backupMoved: false, published: false };
        applied.push(state);

        if (await lstatIfExists(publication.outputPath)) {
          await mkdir(dirname(backupPath), { recursive: true });
          await move(publication.outputPath, backupPath);
          state.backupMoved = true;
        }
        await move(stagedPath, publication.outputPath);
        state.published = true;
      }
    } catch (publishError) {
      const rollbackErrors: unknown[] = [];
      for (const state of applied.reverse()) {
        if (state.published) {
          try {
            await remove(state.outputPath, { force: true });
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (state.backupMoved) {
          try {
            await move(state.backupPath, state.outputPath);
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
      }
      if (rollbackErrors.length > 0) {
        preserveStagingForRecovery = true;
        throw new AggregateError(
          [publishError, ...rollbackErrors],
          `${errorMessage(publishError)}; bundle output rollback failed; recovery data retained at ${stagingRoot}`,
          { cause: publishError },
        );
      }
      throw publishError;
    }
  } catch (error) {
    primaryError = error;
  }

  if (!preserveStagingForRecovery) {
    try {
      await remove(stagingRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      if (primaryError) throw withSecondaryError(primaryError, cleanupError, "staging cleanup failed");
      throw cleanupError;
    }
  }
  if (primaryError) throw primaryError;
  return zipPath;
}
