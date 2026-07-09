import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { slugify, type FontAsset, type Project as ProjectModel } from "@screenshot-studio/core/model";
import { loadProjectFile, writeProjectFile } from "./project-io.js";

const SUPPORTED_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
const GOOGLE_CSS_ENDPOINT = "https://fonts.googleapis.com/css2";
const GOOGLE_FONT_HOST = "fonts.gstatic.com";
const FONT_INGEST_USER_AGENT = "ScreenshotStudio-FontIngest/1.0";

export class FontValidationError extends Error {
  override name = "FontValidationError";
}

export class FontConflictError extends Error {
  override name = "FontConflictError";
}

export class FontNotFoundError extends Error {
  override name = "FontNotFoundError";
}

export class GoogleFontError extends Error {
  override name = "GoogleFontError";
}

export interface FontServiceDependencies {
  fetch?: typeof fetch;
  writeFontFile?: typeof writeFile;
  writeProjectFile?: typeof writeProjectFile;
}

export interface AddFontInput {
  family: string;
  weight: number;
}

export interface AddUploadedFontInput extends AddFontInput {
  filename: string;
  bytes: Uint8Array;
}

export async function loadFontProject(projectPath: string): Promise<ProjectModel> {
  return loadProjectFile(projectPath);
}

export function fontWeight(value: unknown): number {
  const weight = Number(value ?? 400);
  if (!Number.isInteger(weight) || weight < 100 || weight > 900) {
    throw new FontValidationError("weight must be an integer from 100 through 900");
  }
  return weight;
}

export function fontFamily(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FontValidationError("family must be a non-empty string");
  }
  return value.trim();
}

export function findFont(project: ProjectModel, family: string, weight: number): FontAsset | undefined {
  return project.fonts.find((font) => font.family === family && font.weight === weight);
}

function extensionOrThrow(path: string): string {
  const extension = extname(path).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new FontValidationError(`Unsupported font file "${path}". Expected .ttf, .otf, .woff, or .woff2`);
  }
  return extension;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function targetAssetPath(family: string, weight: number, extension: string): string {
  return `assets/fonts/${slugify(family)}-${weight}${extension}`;
}

function googleCssUrl(family: string, weight: number): string {
  const params = new URLSearchParams({ family: `${family}:wght@${weight}` });
  return `${GOOGLE_CSS_ENDPOINT}?${params}`;
}

function extractSingleFontUrl(css: string): string {
  const urls = [...new Set(
    [...css.matchAll(/src:\s*url\(([^)]+)\)/g)]
      .map((match) => match[1]!.trim().replace(/^['"]|['"]$/g, "")),
  )];
  if (urls.length !== 1) {
    throw new GoogleFontError(`Google Fonts returned ${urls.length} font files; expected exactly one full-coverage font file`);
  }
  return urls[0]!;
}

export async function downloadGoogleFont(
  family: string,
  weight: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Buffer; extension: string }> {
  try {
    const cssResponse = await fetchImpl(googleCssUrl(family, weight), {
      headers: { "user-agent": FONT_INGEST_USER_AGENT },
    });
    if (!cssResponse.ok) throw new GoogleFontError(`Google Fonts CSS request failed: HTTP ${cssResponse.status}`);
    const fontUrl = extractSingleFontUrl(await cssResponse.text());
    const parsedFontUrl = new URL(fontUrl);
    if (parsedFontUrl.protocol !== "https:" || parsedFontUrl.hostname !== GOOGLE_FONT_HOST) {
      throw new GoogleFontError(`Google Fonts returned a disallowed font URL: ${fontUrl}`);
    }
    let extension: string;
    try {
      extension = extensionOrThrow(parsedFontUrl.pathname);
    } catch (error) {
      throw new GoogleFontError((error as Error).message);
    }
    const fontResponse = await fetchImpl(parsedFontUrl.href);
    if (!fontResponse.ok) throw new GoogleFontError(`Google Fonts download failed: HTTP ${fontResponse.status}`);
    return { bytes: Buffer.from(await fontResponse.arrayBuffer()), extension };
  } catch (error) {
    if (error instanceof GoogleFontError) throw error;
    throw new GoogleFontError(`Google Fonts request failed: ${(error as Error).message}`);
  }
}

function isManagedFontPath(projectDir: string, assetPath: string): string | undefined {
  const fontsDir = join(projectDir, "assets", "fonts");
  const absolute = resolve(projectDir, assetPath);
  const fromFontsDir = relative(fontsDir, absolute);
  return !isAbsolute(fromFontsDir) && fromFontsDir !== ".." && !fromFontsDir.startsWith("../")
    ? absolute
    : undefined;
}

async function addMaterializedFont(
  projectPath: string,
  input: AddFontInput & { source: FontAsset["source"]; extension: string; bytes: Uint8Array },
  dependencies: FontServiceDependencies = {},
): Promise<ProjectModel> {
  const family = fontFamily(input.family);
  const weight = fontWeight(input.weight);
  const project = await loadProjectFile(projectPath);
  if (findFont(project, family, weight)) {
    throw new FontConflictError(`Font "${family}" ${weight} is already registered`);
  }

  const path = targetAssetPath(family, weight, input.extension);
  const target = join(dirname(projectPath), path);
  await mkdir(dirname(target), { recursive: true });
  try {
    await (dependencies.writeFontFile ?? writeFile)(target, input.bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new FontConflictError(`Refusing to overwrite existing font file: ${target}`);
    }
    throw error;
  }
  const nextProject: ProjectModel = {
    ...project,
    fonts: [...project.fonts, { family, source: input.source, path, weight }],
  };
  try {
    await (dependencies.writeProjectFile ?? writeProjectFile)(projectPath, nextProject);
  } catch (error) {
    await unlink(target).catch(() => undefined);
    throw error;
  }
  return nextProject;
}

export async function addUploadedFont(
  projectPath: string,
  input: AddUploadedFontInput,
  dependencies: FontServiceDependencies = {},
): Promise<ProjectModel> {
  return addMaterializedFont(projectPath, {
    family: input.family,
    weight: input.weight,
    source: "uploaded",
    extension: extensionOrThrow(input.filename),
    bytes: input.bytes,
  }, dependencies);
}

export async function addUploadedFontFile(
  projectPath: string,
  input: AddFontInput & { file: string },
  dependencies: FontServiceDependencies = {},
): Promise<ProjectModel> {
  const extension = extensionOrThrow(input.file);
  if (!await exists(input.file)) throw new FontNotFoundError(`Font file not found: ${input.file}`);
  return addMaterializedFont(projectPath, {
    family: input.family,
    weight: input.weight,
    source: "uploaded",
    extension,
    bytes: await readFile(input.file),
  }, dependencies);
}

export async function addGoogleFont(
  projectPath: string,
  input: AddFontInput,
  dependencies: FontServiceDependencies = {},
): Promise<ProjectModel> {
  const family = fontFamily(input.family);
  const weight = fontWeight(input.weight);
  const project = await loadProjectFile(projectPath);
  if (findFont(project, family, weight)) {
    throw new FontConflictError(`Font "${family}" ${weight} is already registered`);
  }
  const downloaded = await downloadGoogleFont(family, weight, dependencies.fetch);
  return addMaterializedFont(projectPath, {
    family,
    weight,
    source: "google",
    extension: downloaded.extension,
    bytes: downloaded.bytes,
  }, dependencies);
}

export async function removeFont(
  projectPath: string,
  input: AddFontInput,
): Promise<ProjectModel> {
  const family = fontFamily(input.family);
  const weight = fontWeight(input.weight);
  const project = await loadProjectFile(projectPath);
  const font = findFont(project, family, weight);
  if (!font) throw new FontNotFoundError(`Font "${family}" ${weight} is not registered`);

  const nextProject: ProjectModel = {
    ...project,
    fonts: project.fonts.filter((entry) => entry !== font),
  };
  await writeProjectFile(projectPath, nextProject);

  const managedPath = isManagedFontPath(dirname(projectPath), font.path);
  if (managedPath && !nextProject.fonts.some((entry) => entry.path === font.path)) {
    await unlink(managedPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return nextProject;
}
