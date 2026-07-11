// SPDX-License-Identifier: Apache-2.0
import { lstat, readFile, readdir, readlink, stat } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";

export const PACKAGE_LINKS_MANIFEST = ".screenshot-studio-links.json";
const ARCHIVE_DATE = new Date("2000-01-01T00:00:00.000Z");

/** Keep build-machine native optional dependencies out of the published shared render host. */
export function isPortableRenderHostPath(path) {
  const normalized = path.split("\\").join("/");
  return ![
    /(^|\/)node_modules\/\.pnpm\/@img\+sharp-/,
    /(^|\/)node_modules\/\.pnpm\/sharp@/,
    /(^|\/)node_modules\/\.pnpm\/fsevents@/,
    /(^|\/)node_modules\/@img\/sharp-/,
    /(^|\/)node_modules\/sharp(?:\/|$)/,
    /(^|\/)node_modules\/fsevents(?:\/|$)/,
  ].some((pattern) => pattern.test(normalized));
}

function archivePathFor(root, archiveRoot, source) {
  const path = relative(root, source);
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`Package link target escapes the archived root: ${source}`);
  }
  return posix.join(archiveRoot, path.split("\\").join("/"));
}

async function addPath(zip, root, archiveRoot, source, archivePath, links, ancestors, include) {
  if (!include(archivePath)) return;
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
        include,
      );
    }
    return;
  }

  if (metadata.isFile()) {
    zip.file(archivePath, await readFile(source), { createFolders: false, date: ARCHIVE_DATE });
  }
}

export async function addDirectory(zip, directory, archiveRoot = "", options = {}) {
  const root = resolve(directory);
  const entries = await readdir(root);
  const links = [];
  const include = options.include ?? (() => true);
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
      include,
    );
  }
  return links.sort((first, second) => first.path.localeCompare(second.path));
}
