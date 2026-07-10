import {
  autoCropAsset,
  removeBackgroundAsset,
  type ProcessedAsset,
  type RgbColor,
} from "./asset-service.js";

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

export async function runAssetCommand(
  projectPath: string,
  args: string[],
  flags: Record<string, string>,
): Promise<string> {
  const [command, source, ...extra] = args;
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
  throw new Error(`${AUTO_CROP_USAGE}\n${REMOVE_BACKGROUND_USAGE}`);
}
