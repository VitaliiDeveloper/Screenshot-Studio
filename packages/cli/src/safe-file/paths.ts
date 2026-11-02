// SPDX-License-Identifier: Apache-2.0
import { type Stats } from "node:fs";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isProjectRelativePath } from "@screenshot-studio/core/model";
import type { RootBoundary, RootCreationPlan } from "./types.js";
import { hasCode, lstatIfExists } from "./fs-basics.js";

const PREPARED_FILE_STAGE_SUFFIX = ".capture-stage";
const PREPARED_FILE_STAGE_TOKEN = /^[A-Za-z0-9_-]{16,128}$/u;
export function preparedFileStagePaths(relativePath: string, stageToken: string) {
  if (!PREPARED_FILE_STAGE_TOKEN.test(stageToken)) {
    throw new TypeError("Prepared publication requires a bounded opaque stage token");
  }
  assertPortableRelativePath(relativePath);
  const segments = relativePath.split("/");
  const stageName = `.${segments.at(-1)!}.${stageToken}${PREPARED_FILE_STAGE_SUFFIX}`;
  const stageRelativePath = [...segments.slice(0, -1), stageName].join("/");
  return {
    stageRelativePath,
    stageCleanupRelativePath: `${stageRelativePath}.cleanup`,
  };
}
export function assertPortableRelativePath(relativePath: string): void {
  if (!isProjectRelativePath(relativePath)) {
    throw new Error(`Expected a portable project-relative path, received ${JSON.stringify(relativePath)}`);
  }
}
export function assertCanonicalContainment(root: string, path: string): void {
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Resolved path escaped the canonical publication root: ${path}`);
  }
}
function assertRootStats(stats: Stats | null): asserts stats is Stats {
  if (!stats) throw new Error("Publication root must be an existing directory");
  if (stats.isSymbolicLink()) throw new Error("Unsafe symbolic link at publication root");
  if (!stats.isDirectory()) throw new Error("Publication root is not a directory");
}
async function resolveRootBoundary(root: string): Promise<RootBoundary> {
  const requestedRoot = resolve(root);
  assertRootStats(await lstatIfExists(requestedRoot));
  const canonicalRoot = await realpath(requestedRoot);
  assertRootStats(await lstatIfExists(canonicalRoot));
  return { requestedRoot, canonicalRoot };
}
async function revalidateRoot(boundary: RootBoundary): Promise<void> {
  assertRootStats(await lstatIfExists(boundary.requestedRoot));
  const currentCanonicalRoot = await realpath(boundary.requestedRoot);
  if (currentCanonicalRoot !== boundary.canonicalRoot) {
    throw new Error("Publication root changed after its canonical boundary was established");
  }
  assertRootStats(await lstatIfExists(boundary.canonicalRoot));
}
function assertAncestorStats(path: string, stats: Stats | null): asserts stats is Stats {
  if (!stats) throw new Error(`Publication path ancestor disappeared: ${path}`);
  if (stats.isSymbolicLink()) {
    throw new Error(`Unsafe symbolic link in publication path ancestor: ${path}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Publication path ancestor is not a directory: ${path}`);
  }
}
export async function revalidateAncestors(boundary: RootBoundary, ancestors: string[]): Promise<void> {
  await revalidateRoot(boundary);
  for (const ancestor of ancestors) {
    assertAncestorStats(ancestor, await lstatIfExists(ancestor));
    const canonicalAncestor = await realpath(ancestor);
    assertCanonicalContainment(boundary.canonicalRoot, canonicalAncestor);
  }
}
export async function ensureAncestors(
  boundary: RootBoundary,
  segments: string[],
  createMissing: boolean,
): Promise<string[] | null> {
  const ancestors: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const ancestor = join(boundary.canonicalRoot, ...segments.slice(0, index + 1));
    let stats = await lstatIfExists(ancestor);
    if (!stats) {
      if (!createMissing) return null;
      await revalidateAncestors(boundary, ancestors);
      try {
        await mkdir(ancestor);
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
      stats = await lstatIfExists(ancestor);
    }
    assertAncestorStats(ancestor, stats);
    const canonicalAncestor = await realpath(ancestor);
    assertCanonicalContainment(boundary.canonicalRoot, canonicalAncestor);
    ancestors.push(ancestor);
  }
  return ancestors;
}
async function planRootCreation(root: string): Promise<RootCreationPlan> {
  const requestedRoot = resolve(root);
  const missingSegments: string[] = [];
  let cursor = requestedRoot;

  for (;;) {
    let stats: Stats | null;
    try {
      stats = await lstat(cursor);
    } catch (error) {
      if (!hasCode(error, "ENOENT") && !hasCode(error, "ENOTDIR")) throw error;
      stats = null;
    }

    if (stats) {
      const isRequestedRoot = missingSegments.length === 0;
      // Ancestors above the root are the caller's chosen location and may be OS links such as
      // macOS /tmp; only the root itself and the segments created below it must not be links.
      if (isRequestedRoot) assertRootStats(stats);
      const canonicalRoot = await realpath(cursor);
      assertRootStats(await lstatIfExists(canonicalRoot));
      return {
        requestedRoot,
        anchor: { requestedRoot: isRequestedRoot ? cursor : canonicalRoot, canonicalRoot },
        missingSegments,
      };
    }

    const parent = dirname(cursor);
    if (parent === cursor) throw new Error("Publication root has no existing directory ancestor");
    missingSegments.unshift(basename(cursor));
    cursor = parent;
  }
}
export async function resolveOrCreateRootBoundary(root: string): Promise<RootBoundary> {
  const plan = await planRootCreation(root);
  if (plan.missingSegments.length === 0) return plan.anchor;
  await ensureAncestors(plan.anchor, plan.missingSegments, true);
  return resolveRootBoundary(plan.requestedRoot);
}
export async function resolveRootBoundaryIfExists(root: string): Promise<RootBoundary | null> {
  const plan = await planRootCreation(root);
  return plan.missingSegments.length === 0 ? plan.anchor : null;
}
export async function inspectRegularLeaf(
  path: string,
  errorFor: (path: string, stats: Stats) => Error,
): Promise<Stats | null> {
  const stats = await lstatIfExists(path);
  if (!stats) return null;
  if (!stats.isFile()) throw errorFor(path, stats);
  return stats;
}
