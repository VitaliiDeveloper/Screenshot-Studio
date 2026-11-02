// SPDX-License-Identifier: Apache-2.0
import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Where store keys live under a data root. Apart from the key store, so agent code can close the
 * folder to its sandboxes without importing anything that reads keys.
 */
export function storeKeyFolder(root: string): string {
  return join(resolve(root), "store-credentials");
}

/** Resolves symlinks in the longest existing prefix, so a not-yet-created folder still compares by its real parent. */
export async function realPathOf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(await realPathOf(parent), basename(path));
  }
}
