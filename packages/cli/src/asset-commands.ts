// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  autoCropAsset,
  removeBackgroundAsset,
  type ProcessedAsset,
  type RgbColor,
} from "./asset-service.js";
import {
  importProjectImageMutation,
  MAX_PROJECT_IMAGE_BYTES,
  ProjectImageValidationError,
} from "./project-image-service.js";

const IMPORT_USAGE = "Usage: screenshots asset import <file> (relative paths resolve from the current directory)";
const AUTO_CROP_USAGE = "Usage: screenshots asset auto-crop <file> [--threshold 0..255]";
const REMOVE_BACKGROUND_USAGE = "Usage: screenshots asset remove-background <file> [--background RRGGBB] [--tolerance 0..255]";

function parseByteFlag(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error(`--${name} must be an integer from 0 to 255`);
  }
  return parsed;
}

function parseBackground(value: string | undefined): RgbColor | undefined {
  if (value === undefined) return undefined;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value);
  if (!match) throw new Error("--background must be a six-digit RGB hex colour");
  const hex = match[1]!;
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function createdMessage(result: ProcessedAsset): string {
  return `Created ${result.path} (${result.width}x${result.height})`;
}

/** Reads an external image without letting a device, FIFO, or oversized file reach memory. */
async function readImportSource(file: string): Promise<Uint8Array> {
  // O_NONBLOCK: opening a FIFO must not hang before fstat rejects it.
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new ProjectImageValidationError(`Image file not found: ${file}`);
    throw error;
  });
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new ProjectImageValidationError(`Image source is not a file: ${file}`);
    if (stats.size > MAX_PROJECT_IMAGE_BYTES) {
      throw new ProjectImageValidationError("Image file must be 25 MB or smaller");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

export async function runAssetCommand(
  projectPath: string,
  args: string[],
  flags: Record<string, string>,
): Promise<string> {
  const [command, source, ...extra] = args;
  if (command === "import") {
    if (!source || extra.length > 0) throw new Error(IMPORT_USAGE);
    const file = resolve(source);
    const { asset } = await importProjectImageMutation(projectPath, {
      filename: basename(file),
      bytes: await readImportSource(file),
    });
    return `Imported ${asset.path}`;
  }
  if (command === "auto-crop") {
    if (!source || extra.length > 0) throw new Error(AUTO_CROP_USAGE);
    const result = await autoCropAsset(projectPath, source, {
      threshold: parseByteFlag(flags.threshold, "threshold"),
    });
    return createdMessage(result);
  }
  if (command === "remove-background") {
    if (!source || extra.length > 0) throw new Error(REMOVE_BACKGROUND_USAGE);
    const result = await removeBackgroundAsset(projectPath, source, {
      background: parseBackground(flags.background),
      tolerance: parseByteFlag(flags.tolerance, "tolerance"),
    });
    return createdMessage(result);
  }
  throw new Error(`${IMPORT_USAGE}\n${AUTO_CROP_USAGE}\n${REMOVE_BACKGROUND_USAGE}`);
}
