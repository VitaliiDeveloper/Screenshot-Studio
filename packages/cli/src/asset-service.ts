// SPDX-License-Identifier: Apache-2.0
import {
  constants } from "node:fs"; import { lstat,
  open,
  realpath,
  type FileHandle } from "node:fs/promises"; import { basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep } from "node:path"; import sharp from "sharp"; import { resolveExistingProjectPath,
  withProjectMutation,
  errorCode,
} from "@screenshot-studio/core/storage";
import { reconcileCaptureImport } from "./capture-import-recovery.js";
import { loadProjectFile } from "./project-io.js";
import {
  ManagedResourceConflictError,
  publishManagedResourceFile,
  type ManagedResourceFilePublication,
} from "./managed-resource-file.js";

const DEFAULT_AUTO_CROP_THRESHOLD = 10;
const DEFAULT_BACKGROUND_TOLERANCE = 24;

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface ProcessedAsset {
  path: string;
  width: number;
  height: number;
}

export interface AutoCropOptions {
  threshold?: number;
}

export interface RemoveBackgroundOptions {
  background?: RgbColor;
  tolerance?: number;
}

export interface AssetServiceDependencies {
  withProjectMutation?: <T>(projectPath: string, operation: () => Promise<T>) => Promise<T>;
  publishFileSafely?: (
    options: ManagedResourceFilePublication,
  ) => Promise<{ path: string; created: boolean }>;
  openSourceFile?: (path: string, flags: number) => Promise<FileHandle>;
}

interface AssetPaths {
  projectRoot: string;
  sourcePath: string;
  sourceIdentity: AssetIdentity;
}

interface AssetIdentity {
  device: bigint;
  inode: bigint;
  size: bigint;
}

interface AssetStat {
  dev: bigint;
  ino: bigint;
  size: bigint;
  isFile(): boolean;
}

function assertByte(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${name} must be an integer from 0 to 255`);
  }
}

function assertInside(root: string, target: string, label: string): void {
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`${label} must stay inside project root ${root}`);
  }
}

async function resolveAssetPaths(canonicalProjectPath: string, source: string): Promise<AssetPaths> {
  await loadProjectFile(canonicalProjectPath);
  const projectRoot = dirname(canonicalProjectPath);
  const sourcePath = await realpath(resolve(projectRoot, source));
  assertInside(projectRoot, sourcePath, "Asset source");
  const sourceStat = await lstat(sourcePath, { bigint: true }) as AssetStat;
  if (!sourceStat.isFile()) throw new Error(`Asset source is not a file: ${sourcePath}`);
  const sourceIdentity = identityOf(sourceStat);
  await assertNamedSourceBinding({ projectRoot, sourcePath, sourceIdentity });

  return { projectRoot, sourcePath, sourceIdentity };
}

function sourceReadFlags(): number {
  return constants.O_RDONLY
    | constants.O_NONBLOCK
    | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
}

function identityOf(stat: AssetStat): AssetIdentity {
  return { device: stat.dev, inode: stat.ino, size: stat.size };
}

function sameIdentity(stat: AssetStat, expected: AssetIdentity): boolean {
  const identity = identityOf(stat);
  return identity.device === expected.device
    && identity.inode === expected.inode
    && identity.size === expected.size;
}

function sourceChangedError(path: string, cause?: unknown): Error {
  return new Error(
    `Asset source changed or became a symbolic link while it was being read: ${path}`,
    cause === undefined ? undefined : { cause },
  );
}

async function assertNamedSourceBinding(paths: AssetPaths): Promise<void> {
  try {
    const canonicalPath = await realpath(paths.sourcePath);
    assertInside(paths.projectRoot, canonicalPath, "Asset source");
    const named = await lstat(paths.sourcePath, { bigint: true }) as AssetStat;
    if (canonicalPath !== paths.sourcePath
      || !named.isFile()
      || !sameIdentity(named, paths.sourceIdentity)) {
      throw sourceChangedError(paths.sourcePath);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Asset source changed")) throw error;
    throw sourceChangedError(paths.sourcePath, error);
  }
}

async function readAssetSource(
  paths: AssetPaths,
  dependencies: AssetServiceDependencies,
): Promise<Buffer> {
  const openSourceFile = dependencies.openSourceFile ?? open;
  let handle: FileHandle | undefined;
  let input: Buffer | undefined;
  let operationError: unknown;
  let hasOperationError = false;
  try {
    try {
      handle = await openSourceFile(paths.sourcePath, sourceReadFlags());
    } catch (error) {
      if (["ELOOP", "EMLINK", "ENOENT"].includes(errorCode(error) ?? "")) {
        throw sourceChangedError(paths.sourcePath, error);
      }
      throw error;
    }
    const openedBefore = await handle.stat({ bigint: true }) as AssetStat;
    if (!openedBefore.isFile() || !sameIdentity(openedBefore, paths.sourceIdentity)) {
      throw sourceChangedError(paths.sourcePath);
    }
    await assertNamedSourceBinding(paths);
    input = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true }) as AssetStat;
    if (!openedAfter.isFile() || !sameIdentity(openedAfter, paths.sourceIdentity)) {
      throw sourceChangedError(paths.sourcePath);
    }
    await assertNamedSourceBinding(paths);
  } catch (error) {
    operationError = error;
    hasOperationError = true;
  }

  let closeError: unknown;
  let hasCloseError = false;
  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      closeError = error;
      hasCloseError = true;
    }
  }
  if (hasOperationError && hasCloseError) {
    throw new AggregateError(
      [operationError, closeError],
      "Asset source read and handle cleanup failed",
      { cause: operationError },
    );
  }
  if (hasOperationError) throw operationError;
  if (hasCloseError) throw closeError;
  return input!;
}

function safeStem(path: string): string {
  const sourceStem = basename(path, extname(path));
  return sourceStem
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "") || "asset";
}

async function writeProcessedAsset(
  paths: AssetPaths,
  suffix: string,
  png: Buffer,
  width: number,
  height: number,
  publish: NonNullable<AssetServiceDependencies["publishFileSafely"]>,
): Promise<ProcessedAsset> {
  const stem = `${safeStem(paths.sourcePath)}-${suffix}`;
  for (let attempt = 1; ; attempt++) {
    const filename = `${stem}${attempt === 1 ? "" : `-${attempt}`}.png`;
    const relativePath = `assets/processed/${filename}`;
    try {
      const publication = await publish({
        root: paths.projectRoot,
        relativePath,
        bytes: png,
      });
      if (!publication.created) continue;
      return {
        path: relativePath,
        width,
        height,
      };
    } catch (error) {
      if (error instanceof ManagedResourceConflictError) continue;
      if (error instanceof Error && /symbolic link in publication path ancestor/i.test(error.message)) {
        throw new Error(
          `Asset output directory must stay inside project root ${paths.projectRoot} and contain no symbolic links`,
          { cause: error },
        );
      }
      throw error;
    }
  }
}

async function withAssetLease<T>(
  projectPath: string,
  source: string,
  dependencies: AssetServiceDependencies,
  operation: (paths: AssetPaths, input: Buffer) => Promise<T>,
): Promise<T> {
  const canonicalProjectPath = await resolveExistingProjectPath(projectPath);
  const runWithMutation = dependencies.withProjectMutation ?? withProjectMutation;
  return runWithMutation(canonicalProjectPath, async () => {
    await reconcileCaptureImport(canonicalProjectPath);
    const paths = await resolveAssetPaths(canonicalProjectPath, source);
    const input = await readAssetSource(paths, dependencies);
    return operation(paths, input);
  });
}

export async function autoCropAsset(
  projectPath: string,
  source: string,
  options: AutoCropOptions = {},
  dependencies: AssetServiceDependencies = {},
): Promise<ProcessedAsset> {
  const threshold = options.threshold ?? DEFAULT_AUTO_CROP_THRESHOLD;
  assertByte(threshold, "Auto-crop threshold");
  const publish = dependencies.publishFileSafely ?? publishManagedResourceFile;
  return withAssetLease(projectPath, source, dependencies, async (paths, input) => {
    const decoded = await sharp(input)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (decoded.info.channels !== 4) {
      throw new Error("Auto-crop could not decode RGBA pixels");
    }
    const background = edgeConnectedBackgroundMask(
      decoded.data,
      decoded.info.width,
      decoded.info.height,
      undefined,
      threshold,
    );
    const bounds = foregroundBounds(background, decoded.info.width, decoded.info.height);
    const { data, info } = await sharp(decoded.data, {
      raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 },
    }).extract(bounds).png().toBuffer({ resolveWithObject: true });
    return writeProcessedAsset(paths, "auto-crop", data, info.width, info.height, publish);
  });
}

function edgeConnectedBackgroundMask(
  pixels: Buffer,
  width: number,
  height: number,
  explicitReference: RgbColor | undefined,
  tolerance: number,
): Uint8Array {
  const reference = explicitReference ?? (pixels[3] === 0 ? undefined : {
    red: pixels[0]!,
    green: pixels[1]!,
    blue: pixels[2]!,
  });
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const matchesBackground = (pixelIndex: number): boolean => {
    const offset = pixelIndex * 4;
    if (pixels[offset + 3] === 0) return true;
    if (!reference) return false;
    return Math.abs(pixels[offset]! - reference.red) <= tolerance
      && Math.abs(pixels[offset + 1]! - reference.green) <= tolerance
      && Math.abs(pixels[offset + 2]! - reference.blue) <= tolerance;
  };

  const enqueue = (pixelIndex: number): void => {
    if (visited[pixelIndex] || !matchesBackground(pixelIndex)) return;
    visited[pixelIndex] = 1;
    queue[tail++] = pixelIndex;
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    if (height > 1) enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    if (width > 1) enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const pixelIndex = queue[head++]!;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (x > 0) enqueue(pixelIndex - 1);
    if (x + 1 < width) enqueue(pixelIndex + 1);
    if (y > 0) enqueue(pixelIndex - width);
    if (y + 1 < height) enqueue(pixelIndex + width);
  }
  return visited;
}

function foregroundBounds(
  background: Uint8Array,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let pixelIndex = 0; pixelIndex < background.length; pixelIndex++) {
    if (background[pixelIndex]) continue;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) return { left: 0, top: 0, width: 1, height: 1 };
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

export function removeEdgeConnectedBackground(
  pixels: Buffer,
  width: number,
  height: number,
  options: RemoveBackgroundOptions = {},
): void {
  const tolerance = options.tolerance ?? DEFAULT_BACKGROUND_TOLERANCE;
  assertByte(tolerance, "Background tolerance");
  if (pixels.length !== width * height * 4) {
    throw new Error("Background removal requires RGBA pixels");
  }

  const pixelCount = width * height;
  const background = edgeConnectedBackgroundMask(
    pixels,
    width,
    height,
    options.background,
    tolerance,
  );

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
    if (background[pixelIndex]) pixels[pixelIndex * 4 + 3] = 0;
  }
}

export async function removeBackgroundAsset(
  projectPath: string,
  source: string,
  options: RemoveBackgroundOptions = {},
  dependencies: AssetServiceDependencies = {},
): Promise<ProcessedAsset> {
  if (options.background) {
    assertByte(options.background.red, "Background red channel");
    assertByte(options.background.green, "Background green channel");
    assertByte(options.background.blue, "Background blue channel");
  }
  const publish = dependencies.publishFileSafely ?? publishManagedResourceFile;
  return withAssetLease(projectPath, source, dependencies, async (paths, input) => {
    const decoded = await sharp(input)
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (decoded.info.channels !== 4) {
      throw new Error("Background removal could not decode RGBA pixels");
    }
    removeEdgeConnectedBackground(decoded.data, decoded.info.width, decoded.info.height, options);
    const { data, info } = await sharp(decoded.data, {
      raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 },
    }).png().toBuffer({ resolveWithObject: true });
    return writeProcessedAsset(
      paths,
      "background-removed",
      data,
      info.width,
      info.height,
      publish,
    );
  });
}
