// SPDX-License-Identifier: Apache-2.0
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import {
  elementLeaves,
  getLayout,
  isSensitiveProjectArchivePath,
  isTransientResourceBasename,
  mapElementLeaves,
  type Element,
  type Project,
} from "@screenshot-studio/core/model";
import { noFollowFlags } from "@screenshot-studio/core/storage";
import { DesignPack, listBuiltInDesignPacks } from "@screenshot-studio/core/themes";
import {
  listBuiltInTemplatePackMetadata,
  TemplatePack,
  type BuiltInTemplatePackMetadata,
  type ScreenTemplate,
} from "@screenshot-studio/core/templates";

/**
 * Project-local packs: `packs/<id>/screen-pack.json` holds a `TemplatePack` and
 * `packs/<id>/design-pack.json` a `DesignPack`, the exact schemas of the built-in catalogs. Screen
 * pack asset URLs are relative to the pack folder and must name regular files reached without a
 * symbolic link. Node-only: the browser receives parsed packs from a fenced server route.
 */
export const PACKS_DIRECTORY = "packs";
export const SCREEN_PACK_MANIFEST = "screen-pack.json";
export const DESIGN_PACK_MANIFEST = "design-pack.json";

const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_PACK_MANIFEST_BYTES = 1024 * 1024;
/** Same cap as an uploaded project image. */
export const MAX_PACK_ASSET_BYTES = 25 * 1024 * 1024;

export type ProjectPack =
  | { kind: "screen"; pack: TemplatePack; manifest: string }
  | { kind: "design"; pack: DesignPack; manifest: string };

/** One pack that could not be loaded; `file` is project-relative. */
export interface ProjectPackIssue {
  file: string;
  message: string;
}

export interface ProjectPackListing {
  packs: ProjectPack[];
  errors: ProjectPackIssue[];
}

export class ProjectPackError extends Error {
  constructor(readonly file: string, message: string, readonly notFound = false) {
    super(`${file}: ${message}`);
    this.name = "ProjectPackError";
  }
}

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

// Raw errno messages carry absolute paths, which must not reach the browser.
function fsFailure(label: string, relativePath: string, error: unknown): never {
  if (error instanceof ProjectPackError) throw error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") throw new ProjectPackError(label, `missing file ${relativePath}`);
  if (code) throw new ProjectPackError(label, `cannot read ${relativePath} (${code})`);
  throw error;
}

export interface ContainedReadOptions {
  /** A larger file is refused before it is read. */
  maxBytes: number;
  /** Read only this many leading bytes, enough to recognize a file type. */
  length?: number;
}

/**
 * Read one regular file below the canonical `root` without following a link anywhere on its path:
 * the canonical path must equal the lexical one, and the opened file must be the inspected one.
 */
export async function readContainedFile(
  root: string,
  relativePath: string,
  label: string,
  { maxBytes, length }: ContainedReadOptions,
): Promise<Buffer> {
  try {
    const canonicalRoot = await realpath(root);
    const path = join(canonicalRoot, relativePath);
    if (await realpath(path) !== path) throw new ProjectPackError(label, `${relativePath} must not be or pass through a symbolic link`);
    const named = await lstat(path, { bigint: true });
    if (!named.isFile()) throw new ProjectPackError(label, `${relativePath} must be a regular file`);
    const tooLarge = () => new ProjectPackError(label, `${relativePath} is larger than ${maxBytes / 1024 / 1024} MB`);
    const handle = await open(path, noFollowFlags(constants.O_RDONLY | constants.O_NONBLOCK));
    try {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.dev !== named.dev || opened.ino !== named.ino) {
        throw new ProjectPackError(label, `${relativePath} changed while it was read`);
      }
      if (opened.size > BigInt(maxBytes)) throw tooLarge();
      if (length !== undefined) {
        const header = Buffer.alloc(length);
        const { bytesRead } = await handle.read(header, 0, length, 0);
        return header.subarray(0, bytesRead);
      }
      const bytes = await handle.readFile();
      if (bytes.byteLength > maxBytes) throw tooLarge();
      return bytes;
    } finally {
      await handle.close();
    }
  } catch (error) {
    fsFailure(label, relativePath, error);
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Listing only recognizes the format; applying decodes the full image like an upload. */
function isRasterImageHeader(header: Uint8Array): boolean {
  const ascii = (start: number, end: number) => String.fromCharCode(...header.subarray(start, end));
  return PNG_SIGNATURE.every((value, index) => header[index] === value)
    || (header[0] === 0xff && header[1] === 0xd8)
    || (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP");
}

function issues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

/** Every distinct raster asset URL a screen pack references, in first-use order. */
export function packAssetUrls(pack: TemplatePack): string[] {
  const urls = new Set<string>();
  for (const screen of pack.screens) {
    if (screen.background.type === "image") urls.add(screen.background.assetUrl);
    for (const element of screen.elements) {
      for (const leaf of elementLeaves(element)) {
        if ((leaf.type === "screenshot" || leaf.type === "image" || leaf.type === "device-frame") && leaf.assetUrl) {
          urls.add(leaf.assetUrl);
        }
      }
    }
  }
  return [...urls];
}

/** Rewrite pack asset URLs before materializing, so screens already in the layout keep theirs. */
export function withPackAssetUrls(pack: TemplatePack, replacements: ReadonlyMap<string, string>): TemplatePack {
  const swap = (url: string) => replacements.get(url) ?? url;
  return TemplatePack.parse({
    ...pack,
    screens: pack.screens.map((screen) => ({
      ...screen,
      background: screen.background.type === "image"
        ? { ...screen.background, assetUrl: swap(screen.background.assetUrl) }
        : screen.background,
      elements: screen.elements.map((element) => mapElementLeaves(element, (leaf) => (
        (leaf.type === "screenshot" || leaf.type === "image" || leaf.type === "device-frame") && leaf.assetUrl
          ? { ...leaf, assetUrl: swap(leaf.assetUrl) }
          : leaf
      ))),
    })),
  });
}

export function templatePackMetadata(pack: TemplatePack): BuiltInTemplatePackMetadata {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    platform: pack.platform as BuiltInTemplatePackMetadata["platform"],
    device: pack.device as BuiltInTemplatePackMetadata["device"],
    style: pack.style,
    panorama: pack.panorama === true,
    screenCount: pack.screens.length,
  };
}

async function assertPacksDirectory(projectRoot: string): Promise<boolean> {
  let stats;
  try {
    stats = await lstat(join(projectRoot, PACKS_DIRECTORY));
  } catch (error) {
    if (isMissing(error)) return false;
    fsFailure(PACKS_DIRECTORY, PACKS_DIRECTORY, error);
  }
  if (stats.isSymbolicLink()) throw new ProjectPackError(PACKS_DIRECTORY, "must not be a symbolic link");
  if (!stats.isDirectory()) throw new ProjectPackError(PACKS_DIRECTORY, "must be a directory");
  return true;
}

async function manifestOf(projectRoot: string, id: string): Promise<string> {
  const folder = `${PACKS_DIRECTORY}/${id}`;
  if (!PACK_ID.test(id)) throw new ProjectPackError(folder, "folder name must be a lowercase slug, the pack id");
  let stats;
  try {
    stats = await lstat(join(projectRoot, folder));
  } catch (error) {
    if (isMissing(error)) throw new ProjectPackError(folder, "pack not found", true);
    fsFailure(folder, folder, error);
  }
  if (stats.isSymbolicLink()) throw new ProjectPackError(folder, "must not be a symbolic link");
  if (!stats.isDirectory()) throw new ProjectPackError(folder, "must be a directory");
  const present: string[] = [];
  for (const name of [SCREEN_PACK_MANIFEST, DESIGN_PACK_MANIFEST]) {
    try {
      await lstat(join(projectRoot, folder, name));
      present.push(name);
    } catch (error) {
      if (!isMissing(error)) fsFailure(folder, `${folder}/${name}`, error);
    }
  }
  if (present.length !== 1) {
    throw new ProjectPackError(folder, `expected exactly one of ${SCREEN_PACK_MANIFEST} or ${DESIGN_PACK_MANIFEST}`);
  }
  return `${folder}/${present[0]}`;
}

async function readPack(projectRoot: string, id: string): Promise<ProjectPack> {
  const manifest = await manifestOf(projectRoot, id);
  const screen = manifest.endsWith(SCREEN_PACK_MANIFEST);
  let raw: unknown;
  try {
    raw = JSON.parse((await readContainedFile(projectRoot, manifest, manifest, { maxBytes: MAX_PACK_MANIFEST_BYTES })).toString("utf8"));
  } catch (error) {
    if (error instanceof ProjectPackError) throw error;
    throw new ProjectPackError(manifest, `not valid JSON: ${(error as Error).message}`);
  }
  const parsed = screen ? TemplatePack.safeParse(raw) : DesignPack.safeParse(raw);
  if (!parsed.success) throw new ProjectPackError(manifest, `invalid ${screen ? "screen" : "design"} pack: ${issues(parsed.error)}`);
  const pack = parsed.data;
  if (pack.id !== id) throw new ProjectPackError(manifest, `id "${pack.id}" must match its folder name "${id}"`);
  const builtInIds = screen
    ? listBuiltInTemplatePackMetadata().map((builtIn) => builtIn.id)
    : listBuiltInDesignPacks().map((builtIn) => builtIn.id);
  if (builtInIds.includes(id)) throw new ProjectPackError(manifest, `id "${id}" is already a built-in pack`);
  if (!screen) return { kind: "design", pack: pack as DesignPack, manifest };
  for (const url of packAssetUrls(pack as TemplatePack)) {
    // Asset URLs are already portable relative paths (no `..`, absolute, or scheme) by schema.
    const path = `${PACKS_DIRECTORY}/${id}/${url}`;
    if (isSensitiveProjectArchivePath(path) || isTransientResourceBasename(url.split("/").at(-1)!)) {
      throw new ProjectPackError(manifest, `${path} has a hidden, credential-like, or temporary name that project archives drop; rename it`);
    }
    const header = await readContainedFile(projectRoot, path, manifest, { maxBytes: MAX_PACK_ASSET_BYTES, length: 12 });
    if (!isRasterImageHeader(header)) throw new ProjectPackError(manifest, `${path} must be a PNG, JPEG, or WebP image`);
  }
  return { kind: "screen", pack: pack as TemplatePack, manifest };
}

/** Load one pack by id; throws `ProjectPackError` naming the offending file. */
export async function loadProjectPack(projectRoot: string, id: string): Promise<ProjectPack> {
  if (!await assertPacksDirectory(projectRoot)) {
    throw new ProjectPackError(`${PACKS_DIRECTORY}/${id}`, "pack not found", true);
  }
  return readPack(projectRoot, id);
}

/** Read one asset of a loaded screen pack, fenced to the pack folder. */
export function readProjectPackAsset(projectRoot: string, packId: string, assetUrl: string): Promise<Buffer> {
  const folder = `${PACKS_DIRECTORY}/${packId}`;
  return readContainedFile(projectRoot, `${folder}/${assetUrl}`, `${folder}/${SCREEN_PACK_MANIFEST}`, { maxBytes: MAX_PACK_ASSET_BYTES });
}

/** List `packs/` without throwing: valid packs sorted by id, plus one issue per broken entry. */
export async function listProjectPacks(projectRoot: string): Promise<ProjectPackListing> {
  const packs: ProjectPack[] = [];
  const errors: ProjectPackIssue[] = [];
  const record = (file: string, error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code;
    errors.push(error instanceof ProjectPackError
      ? { file: error.file, message: error.message.slice(error.file.length + 2) }
      : { file, message: code ? `cannot read (${code})` : (error as Error).message });
  };
  let entries;
  try {
    if (!await assertPacksDirectory(projectRoot)) return { packs, errors };
    entries = await readdir(join(projectRoot, PACKS_DIRECTORY), { withFileTypes: true });
  } catch (error) {
    record(PACKS_DIRECTORY, error);
    return { packs, errors };
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    // Loose files such as a README are not packs; a linked folder is refused, not skipped.
    if (entry.isFile() || entry.name.startsWith(".")) continue;
    try {
      packs.push(await readPack(projectRoot, entry.name));
    } catch (error) {
      record(`${PACKS_DIRECTORY}/${entry.name}`, error);
    }
  }
  return { packs, errors };
}

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "screen";

/**
 * Snapshot one layout as a screen pack: the root screens of one locale and of the first screen's
 * output family, with literal artboards so a fresh apply renders identically. Asset URLs are kept,
 * so the caller copies each project asset to the same relative path inside the pack folder.
 */
export function templatePackFromLayout(
  project: Project,
  layoutId: string,
  id: string,
  locale?: string,
): { pack: TemplatePack; assets: string[]; skipped: string[] } {
  if (!PACK_ID.test(id)) throw new Error(`Pack id "${id}" must be a lowercase slug`);
  const layout = getLayout(project, layoutId);
  const roots = layout.screens.filter((screen) => screen.variantOf === undefined && screen.storeTargetId === undefined);
  const chosenLocale = locale ?? roots[0]?.locale;
  const inLocale = roots.filter((screen) => screen.locale === chosenLocale);
  const first = inLocale[0];
  if (!first) throw new Error(`Layout "${layout.id}" has no root screens${locale ? ` in locale "${locale}"` : ""}`);
  if (inLocale.some((screen) => screen.direction === "rtl")) {
    throw new Error(`Locale "${chosenLocale}" is right-to-left; export a left-to-right locale, since pack geometry is physical LTR`);
  }
  const screens = inLocale.filter((screen) => screen.platform === first.platform && screen.device === first.device);
  const used = new Set<string>();
  const templates = screens.map((screen) => {
    let screenId = slugify(screen.id);
    for (let suffix = 2; used.has(screenId); suffix += 1) screenId = `${slugify(screen.id)}-${suffix}`;
    used.add(screenId);
    return {
      id: screenId,
      name: screen.name,
      platform: screen.platform,
      device: screen.device,
      artboard: screen.artboard,
      background: screen.background,
      elements: screen.elements as Element[],
    } as ScreenTemplate;
  });
  const pack = TemplatePack.parse({
    id,
    name: layout.name,
    description: `${templates.length} ${first.platform}/${first.device} screens exported from layout "${layout.name}".`,
    platform: first.platform,
    device: first.device,
    style: id,
    ...(layout.mode === "connected" ? { panorama: true } : {}),
    screens: templates,
  });
  return {
    pack,
    assets: packAssetUrls(pack),
    skipped: inLocale.filter((screen) => !screens.includes(screen)).map((screen) => screen.id),
  };
}
