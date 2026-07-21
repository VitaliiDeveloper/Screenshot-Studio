// SPDX-License-Identifier: Apache-2.0
import { readdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Resolve the platform-specific Sharp packages selected by the workspace install. Local tarball
 * installs cannot recover transitive optional dependencies from an offline registry cache, so
 * packed-runtime tests add these exact packages explicitly after installing the candidate.
 */
export async function workspaceSharpRuntimePackages(repoRoot) {
  const sharpRoot = await realpath(join(repoRoot, "packages", "cli", "node_modules", "sharp"));
  const imagePackagesRoot = join(dirname(sharpRoot), "@img");
  const packageNames = (await readdir(imagePackagesRoot))
    .filter((name) => name.startsWith("sharp-"))
    .sort();
  const binaryPackages = packageNames.filter((name) => !name.startsWith("sharp-libvips-"));
  const libvipsPackages = packageNames.filter((name) => name.startsWith("sharp-libvips-"));
  if (binaryPackages.length !== 1 || libvipsPackages.length > 1) {
    throw new Error(`Expected one Sharp binary and at most one libvips runtime, found: ${packageNames.join(", ")}`);
  }
  return Promise.all(packageNames.map((name) => realpath(join(imagePackagesRoot, name))));
}
