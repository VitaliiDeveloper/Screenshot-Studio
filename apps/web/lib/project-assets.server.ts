// SPDX-License-Identifier: Apache-2.0
import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PROJECT_IMAGE_EXTENSIONS, type ProjectImageAsset } from "@web/lib/project-assets.js";

const IMAGE_EXTENSIONS = new Set<string>(PROJECT_IMAGE_EXTENSIONS);
const ASSET_ROOTS = ["assets", "screenshots"] as const;

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

async function walkImages(
  directory: string,
  projectRoot: string,
  source: ProjectImageAsset["source"],
  output: ProjectImageAsset[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((first, second) => first.name < second.name ? -1 : first.name > second.name ? 1 : 0);
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkImages(path, projectRoot, source, output);
      continue;
    }
    if (!entry.isFile() || !IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const canonical = await realpath(path);
    if (!isWithin(projectRoot, canonical)) continue;
    output.push({
      path: portablePath(relative(projectRoot, path)),
      name: entry.name,
      source,
    });
  }
}

/** Discover regular, non-symlinked project images under the documented source/asset roots. */
export async function listProjectImageAssets(projectPath: string): Promise<ProjectImageAsset[]> {
  const canonicalProject = await realpath(resolve(projectPath));
  const projectRoot = dirname(canonicalProject);
  const output: ProjectImageAsset[] = [];
  for (const source of ASSET_ROOTS) {
    const directory = join(projectRoot, source);
    try {
      const stats = await lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) continue;
      const canonical = await realpath(directory);
      if (!isWithin(projectRoot, canonical)) continue;
      await walkImages(directory, projectRoot, source, output);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return output.sort((first, second) => (
    first.path < second.path ? -1 : first.path > second.path ? 1 : 0
  ));
}
