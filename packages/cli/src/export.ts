import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import JSZip from "jszip";
import {
  parseProjectJson,
  getScreen,
  type Project,
} from "@screenshot-studio/core/model";
import {
  parseStoreSpecs,
  findStoreSize,
  exportPixelRatio,
  stripAlpha,
  assertDimensions,
  type StoreSize,
  type BundleEntry,
} from "@screenshot-studio/core/export";
import { renderScreenToPng, type RenderBrowserSession } from "./render-driver.js";

/**
 * Export orchestration (Node side). Renders a screen through the served web renderer, then does
 * the store post-processing that must happen off-canvas: strip alpha (stores reject
 * transparency) and assert exact target dimensions (docs/architecture.md §4). One export path,
 * shared by the CLI command and the parity harness — the same result the UI button must match.
 */
export interface ExportScreenOptions {
  baseUrl: string;
  projectPath: string;
  screenId: string;
  target: StoreSize;
  headless?: boolean;
}

/** Render + flatten + verify one screen, returning a store-ready PNG buffer. */
export async function exportScreenToPng(opts: ExportScreenOptions): Promise<Buffer> {
  const { baseUrl, projectPath, screenId, target, headless } = opts;
  const project = await loadProject(projectPath);
  const screen = getScreen(project, screenId);

  const pixelRatio = exportPixelRatio(screen.artboard, { width: target.width, height: target.height });
  const raw = await renderScreenToPng({ baseUrl, projectPath, screenId, pixelRatio, headless });

  const flattened = stripAlpha(raw);
  assertDimensions(flattened, { width: target.width, height: target.height });
  return flattened;
}

async function loadProject(projectPath: string): Promise<Project> {
  return parseProjectJson(await readFile(projectPath, "utf8"));
}

/** Resolve a target store size for a screen from store-specs.json. */
export async function resolveTarget(
  storeSpecsPath: string,
  platform: string,
  device: string,
  sizeId: string,
): Promise<StoreSize> {
  const specs = parseStoreSpecs(JSON.parse(await readFile(storeSpecsPath, "utf8")));
  return findStoreSize(specs, platform, device, sizeId);
}

export interface RenderedBundleEntry {
  entry: BundleEntry;
  png: Buffer;
}

function resolveSafeBundleOutputPath(outDir: string, relativePath: string): string {
  const segments = relativePath.split("/");
  if (
    isAbsolute(relativePath)
    || relativePath.includes("\\")
    || relativePath.includes("\0")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe bundle output path "${relativePath}"`);
  }
  const root = resolve(outDir);
  const outputPath = resolve(root, relativePath);
  const fromRoot = relative(root, outputPath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Unsafe bundle output path "${relativePath}"`);
  }
  return outputPath;
}

async function lstatIfExists(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertDirectoryNotSymlink(path: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (stats.isSymbolicLink()) throw new Error(`Unsafe symbolic link in bundle output path "${path}"`);
  if (!stats.isDirectory()) throw new Error(`Bundle output ancestor is not a directory "${path}"`);
}

async function preflightOutputSymlinks(outDir: string, outputPath: string): Promise<void> {
  const root = resolve(outDir);
  const rootStats = await lstatIfExists(root);
  if (rootStats) assertDirectoryNotSymlink(root, rootStats);

  const directory = dirname(outputPath);
  const relativeDirectory = relative(root, directory);
  let current = root;
  for (const segment of relativeDirectory === "" ? [] : relativeDirectory.split(sep)) {
    current = join(current, segment);
    const stats = await lstatIfExists(current);
    if (!stats) break;
    assertDirectoryNotSymlink(current, stats);
  }

  const outputStats = await lstatIfExists(outputPath);
  if (outputStats?.isSymbolicLink()) {
    throw new Error(`Unsafe symbolic link at bundle output file "${outputPath}"`);
  }
  if (outputStats?.isDirectory()) {
    throw new Error(`Bundle output file is an existing directory "${outputPath}"`);
  }
}

async function ensureSafeOutputDirectory(outDir: string, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const root = resolve(outDir);
  const relativeDirectory = relative(root, directory);
  let current = root;
  for (const segment of ["", ...(relativeDirectory === "" ? [] : relativeDirectory.split(sep))]) {
    if (segment) current = join(current, segment);
    const stats = await lstat(current);
    assertDirectoryNotSymlink(current, stats);
  }
}

async function writeFileNoFollow(path: string, bytes: Buffer): Promise<void> {
  const flags = constants.O_WRONLY
    | constants.O_CREAT
    | constants.O_TRUNC
    | (constants.O_NOFOLLOW ?? 0);
  const handle = await open(path, flags, 0o666);
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
}

export async function writeBundleOutputs({
  outDir,
  entries,
}: {
  outDir: string;
  entries: RenderedBundleEntry[];
}): Promise<string> {
  const seenPaths = new Set<string>();
  const outputs = entries.map(({ entry, png }) => {
    const outputPath = resolveSafeBundleOutputPath(outDir, entry.relativePath);
    const collisionKey = entry.relativePath.normalize("NFC").toLowerCase();
    if (seenPaths.has(collisionKey)) {
      throw new Error(`Duplicate bundle output path "${entry.relativePath}"`);
    }
    seenPaths.add(collisionKey);
    return { entry, png, outputPath };
  });
  const zipPath = join(outDir, "app-store-screenshots-bundle.zip");
  for (const { outputPath } of outputs) {
    await preflightOutputSymlinks(outDir, outputPath);
  }
  await preflightOutputSymlinks(outDir, zipPath);

  const zip = new JSZip();

  for (const { entry, png, outputPath } of outputs) {
    await ensureSafeOutputDirectory(outDir, dirname(outputPath));
    await writeFileNoFollow(outputPath, png);
    zip.file(entry.relativePath, png);
  }

  await ensureSafeOutputDirectory(outDir, outDir);
  await writeFileNoFollow(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
  return zipPath;
}

export async function exportBundle({
  baseUrl,
  projectPath,
  outDir,
  entries,
  renderSession,
}: {
  baseUrl: string;
  projectPath: string;
  outDir: string;
  entries: BundleEntry[];
  renderSession: Pick<RenderBrowserSession, "renderScreenToPng">;
}): Promise<string> {
  const rendered: RenderedBundleEntry[] = [];

  for (const entry of entries) {
    try {
      const pixelRatio = exportPixelRatio(entry.screen.artboard, {
        width: entry.target.width,
        height: entry.target.height,
      });
      const raw = await renderSession.renderScreenToPng({
        baseUrl,
        projectPath,
        screenId: entry.screen.id,
        pixelRatio,
      });
      const flattened = stripAlpha(raw);
      assertDimensions(flattened, { width: entry.target.width, height: entry.target.height });
      rendered.push({ entry, png: flattened });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to export screen "${entry.screen.id}" target "${entry.target.id}": ${message}`, {
        cause: err,
      });
    }
  }

  return writeBundleOutputs({ outDir, entries: rendered });
}
