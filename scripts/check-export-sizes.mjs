// SPDX-License-Identifier: Apache-2.0
// Usage: node scripts/check-export-sizes.mjs <export-dir> <project.json> <store-specs.json> <layout-id>
// Asserts a default-profile export holds one PNG per layout screen, with the store target's pixel size.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("not a PNG");
  }
  return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

// shortcut: counts root screens only, extend when an exported example uses screen variants.
export function expectedSizes(project, specs, layoutId) {
  const layout = project.layouts.find((entry) => entry.id === layoutId);
  if (!layout) throw new Error(`Layout not found: ${layoutId}`);
  return layout.screens.map((screen) => {
    const family = specs.platforms[screen.platform]?.families[screen.device];
    const sizeId = screen.storeTargetId ?? family?.leadStoreSizeId;
    const target = family?.targets.find((entry) => entry.id === sizeId);
    if (!target) throw new Error(`No store target for ${screen.platform}/${screen.device}/${sizeId}`);
    return `${target.width}x${target.height}`;
  });
}

export function compareSizes(expected, actual) {
  const sorted = (sizes) => [...sizes].sort().join(", ");
  return sorted(expected) === sorted(actual)
    ? []
    : [`Expected ${expected.length} PNGs [${sorted(expected)}], found ${actual.length} [${sorted(actual)}]`];
}

export async function exportedSizes(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".png"));
  return Promise.all(files.map(async (entry) => pngSize(await readFile(join(entry.parentPath, entry.name)))));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, projectPath, specsPath, layoutId] = process.argv.slice(2);
  if (!dir || !projectPath || !specsPath || !layoutId) {
    console.error("Usage: check-export-sizes.mjs <export-dir> <project.json> <store-specs.json> <layout-id>");
    process.exit(2);
  }
  const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
  const expected = expectedSizes(await readJson(projectPath), await readJson(specsPath), layoutId);
  const actual = await exportedSizes(dir);
  const errors = compareSizes(expected, actual);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`OK: ${actual.length} PNGs match the project's store sizes (${[...actual].sort().join(", ")})`);
}
