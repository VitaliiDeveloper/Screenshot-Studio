import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import sharp from "sharp";
import { loadProjectFile } from "./project-io.js";

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

interface AssetPaths {
  projectRoot: string;
  sourcePath: string;
  outputDir: string;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
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

async function realDirectoryOrCreate(root: string, path: string): Promise<string> {
  try {
    const resolved = await realpath(path);
    assertInside(root, resolved, "Asset output directory");
    if (!(await stat(resolved)).isDirectory()) {
      throw new Error(`Asset output path is not a directory: ${resolved}`);
    }
    return path;
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
    await mkdir(path);
    const resolved = await realpath(path);
    assertInside(root, resolved, "Asset output directory");
    return path;
  }
}

async function resolveAssetPaths(projectPath: string, source: string): Promise<AssetPaths> {
  const realProjectPath = await realpath(resolve(projectPath));
  await loadProjectFile(realProjectPath);
  const projectRoot = dirname(realProjectPath);
  const sourcePath = await realpath(resolve(projectRoot, source));
  assertInside(projectRoot, sourcePath, "Asset source");
  if (!(await stat(sourcePath)).isFile()) {
    throw new Error(`Asset source is not a file: ${sourcePath}`);
  }

  const assetsDir = await realDirectoryOrCreate(projectRoot, join(projectRoot, "assets"));
  const outputDir = await realDirectoryOrCreate(projectRoot, join(assetsDir, "processed"));
  return { projectRoot, sourcePath, outputDir };
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
): Promise<ProcessedAsset> {
  const stem = `${safeStem(paths.sourcePath)}-${suffix}`;
  for (let attempt = 1; ; attempt++) {
    const filename = `${stem}${attempt === 1 ? "" : `-${attempt}`}.png`;
    const outputPath = join(paths.outputDir, filename);
    try {
      await writeFile(outputPath, png, { flag: "wx" });
      return {
        path: relative(paths.projectRoot, outputPath).split(sep).join("/"),
        width,
        height,
      };
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
    }
  }
}

export async function autoCropAsset(
  projectPath: string,
  source: string,
  options: AutoCropOptions = {},
): Promise<ProcessedAsset> {
  const threshold = options.threshold ?? DEFAULT_AUTO_CROP_THRESHOLD;
  assertByte(threshold, "Auto-crop threshold");
  const paths = await resolveAssetPaths(projectPath, source);
  const input = await readFile(paths.sourcePath);
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
  return writeProcessedAsset(paths, "auto-crop", data, info.width, info.height);
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
): Promise<ProcessedAsset> {
  if (options.background) {
    assertByte(options.background.red, "Background red channel");
    assertByte(options.background.green, "Background green channel");
    assertByte(options.background.blue, "Background blue channel");
  }
  const paths = await resolveAssetPaths(projectPath, source);
  const input = await readFile(paths.sourcePath);
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
  return writeProcessedAsset(paths, "background-removed", data, info.width, info.height);
}
