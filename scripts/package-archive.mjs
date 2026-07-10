// SPDX-License-Identifier: Apache-2.0
import { lstat, readFile, readdir, readlink, stat } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";

export const PACKAGE_LINKS_MANIFEST = ".screenshot-studio-links.json";
const ARCHIVE_DATE = new Date("2000-01-01T00:00:00.000Z");

function archivePathFor(root, archiveRoot, source) {
  const path = relative(root, source);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`Package link target escapes the archived root: ${source}`);
  }
  return posix.join(archiveRoot, path.split("\\").join("/"));
}

async function addPath(zip, root, archiveRoot, source, archivePath, links, ancestors) {
  const metadata = await lstat(source);

  if (metadata.isSymbolicLink()) {
    const target = await readlink(source);
    const resolvedTarget = isAbsolute(target) ? target : resolve(dirname(source), target);
    const targetMetadata = await stat(resolvedTarget);
    links.push({
      path: archivePath,
      target: archivePathFor(root, archiveRoot, resolvedTarget),
      type: targetMetadata.isDirectory() ? "directory" : "file",
    });
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
      await addPath(
        zip,
        root,
        archiveRoot,
        resolve(source, entry),
        posix.join(archivePath, entry),
        links,
        nextAncestors,
      );
    }
    return;
  }

  if (metadata.isFile()) {
    zip.file(archivePath, await readFile(source), { createFolders: false, date: ARCHIVE_DATE });
  }
}

export async function addDirectory(zip, directory, archiveRoot = "") {
  const root = resolve(directory);
  const entries = await readdir(root);
  const links = [];
  entries.sort();
  for (const entry of entries) {
    await addPath(
      zip,
      root,
      archiveRoot,
      resolve(root, entry),
      posix.join(archiveRoot, entry),
      links,
      new Set(),
    );
  }
  return links.sort((first, second) => first.path.localeCompare(second.path));
}
