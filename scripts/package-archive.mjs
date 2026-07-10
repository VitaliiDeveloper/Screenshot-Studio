// SPDX-License-Identifier: Apache-2.0
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { dirname, isAbsolute, posix, resolve } from "node:path";

async function addPath(zip, source, archivePath, ancestors) {
  const metadata = await lstat(source);

  if (metadata.isSymbolicLink()) {
    const target = await readlink(source);
    const resolvedTarget = isAbsolute(target) ? target : resolve(dirname(source), target);
    await addPath(zip, resolvedTarget, archivePath, ancestors);
    return;
  }

  if (metadata.isDirectory()) {
    const resolvedSource = resolve(source);
    if (ancestors.has(resolvedSource)) {
      throw new Error(`Cannot archive cyclic directory link at ${source}`);
    }

    const nextAncestors = new Set(ancestors).add(resolvedSource);
    const entries = await readdir(source);
    entries.sort();
    for (const entry of entries) {
      await addPath(zip, resolve(source, entry), posix.join(archivePath, entry), nextAncestors);
    }
    return;
  }

  if (metadata.isFile()) {
    zip.file(archivePath, await readFile(source));
  }
}

export async function addDirectory(zip, directory, archiveRoot = "") {
  const entries = await readdir(directory);
  entries.sort();
  for (const entry of entries) {
    await addPath(zip, resolve(directory, entry), posix.join(archiveRoot, entry), new Set());
  }
}
