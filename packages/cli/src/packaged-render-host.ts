// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

export interface PreparedRenderHost {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}

type ResolvePackageManifest = (name: string, from: string) => string;
type MaterializeSharpRuntime = (destination: string) => Promise<string[]>;

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceWebDir = resolve(packageRoot, "../../apps/web");
const packagedWebArchive = join(packageRoot, "runtime", "web.zip");
const packagedServerEntry = join("apps", "web", "server.js");
const packageLinksManifest = ".screenshot-studio-links.json";

interface PackageLink {
  path: string;
  target: string;
  type: "directory" | "file";
}

function resolvePackageManifest(name: string, from: string): string {
  const require = createRequire(from);
  try {
    return require.resolve(`${name}/package.json`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" && code !== "MODULE_NOT_FOUND") throw error;
  }
  let cursor = dirname(from);
  while (true) {
    for (const base of [cursor, join(cursor, "node_modules")]) {
      const candidate = join(base, ...name.split("/"), "package.json");
      if (existsSync(candidate)) {
        const manifest = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
        if (manifest.name === name) return candidate;
      }
    }
    const parent = resolve(cursor, "..");
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`Could not resolve package manifest for ${name}`);
}

/** Materialize the current machine's installed Sharp packages into the OS-neutral web host. */
export async function materializeSharpRuntime(
  destination: string,
  resolveManifest: ResolvePackageManifest = resolvePackageManifest,
): Promise<string[]> {
  const sharpManifestPath = await realpath(resolveManifest("sharp", fileURLToPath(import.meta.url)));
  const manifest = JSON.parse(await readFile(sharpManifestPath, "utf8")) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const required = Object.keys(manifest.dependencies ?? {});
  const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}));
  const packageNames = ["sharp", ...required, ...optional].sort();
  const copied: string[] = [];

  for (const name of packageNames) {
    let manifestPath: string;
    try {
      manifestPath = name === "sharp"
        ? sharpManifestPath
        : resolveManifest(name, sharpManifestPath);
      manifestPath = await realpath(manifestPath);
    } catch (error) {
      if (optional.has(name)) continue;
      throw error;
    }
    const target = join(destination, "node_modules", ...name.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await rm(target, { recursive: true, force: true });
    await cp(dirname(manifestPath), target, { recursive: true, dereference: true });
    copied.push(name);
  }
  return copied;
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** Extract the trusted build-time standalone host without accepting archive path traversal. */
export async function extractWebArchive(archivePath: string, destination: string): Promise<void> {
  const archive = await JSZip.loadAsync(await readFile(archivePath));
  for (const entry of Object.values(archive.files)) {
    const originalName = entry.unsafeOriginalName ?? entry.name;
    if (
      !isWithin(destination, resolve(destination, originalName))
      || !isWithin(destination, resolve(destination, entry.name))
    ) {
      throw new Error(`Unsafe packaged render-host path "${originalName}"`);
    }
  }
  const manifestEntry = archive.file(packageLinksManifest);
  const manifest = manifestEntry
    ? JSON.parse(await manifestEntry.async("string")) as { version?: unknown; links?: unknown }
    : { version: 1, links: [] };
  if (manifest.version !== 1 || !Array.isArray(manifest.links)) {
    throw new Error("Invalid packaged render-host link manifest");
  }
  const links = manifest.links as PackageLink[];
  for (const entry of Object.values(archive.files)) {
    if (entry.name === packageLinksManifest) continue;
    const target = resolve(destination, entry.name);
    if (entry.dir) {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await entry.async("nodebuffer"));
  }
  for (const link of links) {
    if (
      !link
      || typeof link.path !== "string"
      || typeof link.target !== "string"
      || (link.type !== "directory" && link.type !== "file")
    ) {
      throw new Error("Invalid packaged render-host link entry");
    }
    const linkPath = resolve(destination, link.path);
    const targetPath = resolve(destination, link.target);
    if (!isWithin(destination, linkPath) || !isWithin(destination, targetPath)) {
      throw new Error(`Unsafe packaged render-host link "${link.path}"`);
    }
    const targetStats = await lstat(targetPath);
    if (link.type === "directory" && !targetStats.isDirectory()) {
      throw new Error(`Packaged render-host directory link has a non-directory target "${link.path}"`);
    }
    if (link.type === "file" && !targetStats.isFile()) {
      throw new Error(`Packaged render-host file link has a non-file target "${link.path}"`);
    }
    await mkdir(dirname(linkPath), { recursive: true });
    if (link.type === "file") {
      await copyFile(targetPath, linkPath);
    } else {
      await symlink(
        process.platform === "win32" ? targetPath : relative(dirname(linkPath), targetPath),
        linkPath,
        process.platform === "win32" ? "junction" : "dir",
      );
    }
  }
}

export async function preparePackagedRenderHost(
  port: number,
  archivePath = packagedWebArchive,
  materialize: MaterializeSharpRuntime = materializeSharpRuntime,
): Promise<PreparedRenderHost> {
  const directory = await mkdtemp(join(tmpdir(), "screenshot-studio-web-"));
  try {
    await extractWebArchive(archivePath, directory);
    await materialize(directory);
    const entry = join(directory, packagedServerEntry);
    if (!existsSync(entry)) throw new Error(`Packaged render host is missing ${packagedServerEntry}`);
    return {
      command: process.execPath,
      args: [entry],
      cwd: dirname(entry),
      env: { NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1" },
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function prepareRenderHost(port: number): Promise<PreparedRenderHost> {
  if (existsSync(packagedWebArchive)) {
    return preparePackagedRenderHost(port);
  }
  return {
    command: "pnpm",
    args: ["exec", "next", "dev", "--port", String(port)],
    cwd: sourceWebDir,
    env: { NODE_ENV: "development" },
    cleanup: async () => undefined,
  };
}
