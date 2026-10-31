// SPDX-License-Identifier: Apache-2.0
import { basename, dirname, extname } from "node:path";
import sharp from "sharp";
import {
  ProjectRevisionConflictError,
  readIdentifiedProjectSnapshot,
  resolveExistingProjectPath,
  withProjectMutation,
  type ProjectFileDependencies,
  type ProjectLockOptions,
} from "@screenshot-studio/core/storage";
import { reconcileCaptureImport } from "./capture-import-recovery.js";
import {
  ManagedResourceConflictError,
  publishManagedResourceFile,
  type ManagedResourceFilePublication,
} from "./managed-resource-file.js";

export const MAX_PROJECT_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PROJECT_IMAGE_PIXELS = 80_000_000;
const IMPORTED_ASSET_PREFIX = "assets/imported/";

export class ProjectImageValidationError extends Error {
  override name = "ProjectImageValidationError";
}

export interface ProjectImageServiceDependencies {
  withProjectMutation?: <T>(projectPath: string, operation: () => Promise<T>) => Promise<T>;
  publishFileSafely?: (
    options: ManagedResourceFilePublication,
  ) => Promise<{ path: string; created: boolean }>;
  lockOptions?: ProjectLockOptions;
  fileDependencies?: ProjectFileDependencies;
}

export interface ImportProjectImageInput {
  filename: string;
  bytes: Uint8Array;
}

export interface ImportProjectImagePreconditions {
  expectedRevision?: string;
}

export interface ImportedProjectImage {
  asset: {
    path: string;
    name: string;
    source: "assets";
  };
  revision: string;
}

interface ImageInspection {
  extension: ".jpg" | ".png" | ".webp";
  width: number;
  height: number;
}

function invalidImage(): never {
  throw new ProjectImageValidationError("Image must be a valid PNG, JPEG, or WebP file");
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width <= 0 || height <= 0 || width * height > MAX_PROJECT_IMAGE_PIXELS) {
    invalidImage();
  }
}

function inspectPng(bytes: Uint8Array): ImageInspection | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) return undefined;
  if (bytes.byteLength < 45
    || bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13
    || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") invalidImage();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  assertDimensions(width, height);
  if (String.fromCharCode(...bytes.slice(-8, -4)) !== "IEND") invalidImage();
  return { extension: ".png", width, height };
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function inspectJpeg(bytes: Uint8Array): ImageInspection | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  if (bytes.byteLength < 12 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) invalidImage();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) invalidImage();
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.byteLength) invalidImage();
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (length < 7) invalidImage();
      const height = view.getUint16(offset + 3);
      const width = view.getUint16(offset + 5);
      assertDimensions(width, height);
      return { extension: ".jpg", width, height };
    }
    offset += length;
  }
  invalidImage();
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function inspectWebp(bytes: Uint8Array): ImageInspection | undefined {
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF"
    || String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP") return undefined;
  if (bytes.byteLength < 30) invalidImage();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 > bytes.byteLength) invalidImage();
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  let width: number;
  let height: number;
  if (chunk === "VP8X") {
    width = readUint24LittleEndian(bytes, 24) + 1;
    height = readUint24LittleEndian(bytes, 27) + 1;
  } else if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) invalidImage();
    width = 1 + (bytes[21]! | ((bytes[22]! & 0x3f) << 8));
    height = 1 + ((bytes[22]! >> 6) | (bytes[23]! << 2) | ((bytes[24]! & 0x0f) << 10));
  } else if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) invalidImage();
    width = view.getUint16(26, true) & 0x3fff;
    height = view.getUint16(28, true) & 0x3fff;
  } else {
    invalidImage();
  }
  assertDimensions(width, height);
  return { extension: ".webp", width, height };
}

function inspectImage(bytes: Uint8Array): ImageInspection {
  return inspectPng(bytes) ?? inspectJpeg(bytes) ?? inspectWebp(bytes) ?? invalidImage();
}

async function assertImageDecodes(bytes: Uint8Array, inspection: ImageInspection): Promise<void> {
  try {
    const decoded = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_PROJECT_IMAGE_PIXELS,
    }).raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== inspection.width || decoded.info.height !== inspection.height) {
      invalidImage();
    }
  } catch (error) {
    if (error instanceof ProjectImageValidationError) throw error;
    invalidImage();
  }
}

/** Reject bytes that the upload path would refuse before a project element references them. */
export async function assertProjectImageBytes(bytes: Uint8Array): Promise<ImageInspection["extension"]> {
  const inspection = inspectImage(bytes);
  await assertImageDecodes(bytes, inspection);
  return inspection.extension;
}

export function safeStem(path: string): string {
  const sourceStem = basename(path, extname(path));
  return sourceStem
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "") || "asset";
}

/** Import one external image into project-owned storage without mutating project JSON. */
export async function importProjectImageMutation(
  projectPath: string,
  input: ImportProjectImageInput,
  dependencies: ProjectImageServiceDependencies = {},
  preconditions: ImportProjectImagePreconditions = {},
): Promise<ImportedProjectImage> {
  if (typeof input.filename !== "string" || input.filename.trim().length === 0) {
    throw new ProjectImageValidationError("Image filename must not be empty");
  }
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    throw new ProjectImageValidationError("Image file must not be empty");
  }
  if (input.bytes.byteLength > MAX_PROJECT_IMAGE_BYTES) {
    throw new ProjectImageValidationError("Image file must be 25 MB or smaller");
  }

  const inspection = inspectImage(input.bytes);
  await assertImageDecodes(input.bytes, inspection);
  const { extension } = inspection;
  const canonicalProjectPath = await resolveExistingProjectPath(projectPath);
  const projectRoot = dirname(canonicalProjectPath);
  const runWithMutation = dependencies.withProjectMutation ?? ((path, operation) => (
    withProjectMutation(path, operation, dependencies.lockOptions)
  ));
  const publish = dependencies.publishFileSafely ?? publishManagedResourceFile;
  const stem = safeStem(input.filename);

  return runWithMutation(canonicalProjectPath, async () => {
    await reconcileCaptureImport(canonicalProjectPath);
    const current = await readIdentifiedProjectSnapshot(
      canonicalProjectPath,
      dependencies.fileDependencies,
    );
    if (preconditions.expectedRevision !== undefined
      && current.revision !== preconditions.expectedRevision) {
      throw new ProjectRevisionConflictError(preconditions.expectedRevision, current.revision);
    }

    for (let attempt = 1; attempt <= 10_000; attempt++) {
      const name = `${stem}${attempt === 1 ? "" : `-${attempt}`}${extension}`;
      const relativePath = `${IMPORTED_ASSET_PREFIX}${name}`;
      try {
        await publish({ root: projectRoot, relativePath, bytes: input.bytes });
        return {
          asset: { path: relativePath, name, source: "assets" },
          revision: current.revision,
        };
      } catch (error) {
        if (error instanceof ManagedResourceConflictError) continue;
        throw error;
      }
    }

    throw new Error("Could not allocate a collision-safe imported image filename");
  });
}
