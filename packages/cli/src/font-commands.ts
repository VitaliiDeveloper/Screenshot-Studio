import { access, copyFile, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { slugify, type FontAsset, type Project as ProjectModel } from "@screenshot-studio/core/model";
import { loadProjectFile, writeProjectFile } from "./project-io.js";

const SUPPORTED_EXTENSIONS = new Set([".ttf", ".otf", ".woff", ".woff2"]);
const GOOGLE_CSS_ENDPOINT = "https://fonts.googleapis.com/css2";

export type FontAction =
  | { kind: "list" }
  | { kind: "add"; source: "uploaded"; file: string; family: string; weight: number }
  | { kind: "add"; source: "google"; family: string; weight: number }
  | { kind: "rm"; family: string; weight: number };

export interface FontCommandDependencies {
  fetch?: typeof fetch;
}

function fontWeight(flags: Record<string, string>): number {
  const weight = Number(flags.weight ?? "400");
  if (!Number.isInteger(weight) || weight < 100 || weight > 900) {
    throw new Error("--weight must be an integer from 100 through 900");
  }
  return weight;
}

export function resolveFontAction(args: string[], flags: Record<string, string>): FontAction {
  const [subcommand, value] = args;
  switch (subcommand) {
    case "list":
      return { kind: "list" };
    case "add": {
      const weight = fontWeight(flags);
      if (flags.google) {
        if (value) throw new Error("font add accepts either <file> or --google <family>, not both");
        return { kind: "add", source: "google", family: flags.google, weight };
      }
      if (!value) throw new Error("Usage: screenshots font add <file> --family <family> [--weight <100..900>]");
      if (!flags.family) throw new Error("font add <file> requires --family <family>");
      return { kind: "add", source: "uploaded", file: resolve(value), family: flags.family, weight };
    }
    case "rm":
      if (!value) throw new Error("Usage: screenshots font rm <family> [--weight <100..900>]");
      return { kind: "rm", family: value, weight: fontWeight(flags) };
    default:
      throw new Error("Usage: screenshots font <add|list|rm>");
  }
}

export function findFont(project: ProjectModel, family: string, weight: number): FontAsset | undefined {
  return project.fonts.find((font) => font.family === family && font.weight === weight);
}

export function formatFontList(project: ProjectModel): string {
  return project.fonts.map((font) => `${font.family} ${font.weight} ${font.source} ${font.path}`).join("\n");
}

function extensionOrThrow(path: string): string {
  const extension = extname(path).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported font file "${path}". Expected .ttf, .otf, .woff, or .woff2`);
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
  const urls = [...new Set([...css.matchAll(/src:\s*url\(([^)]+)\)/g)].map((match) => match[1]!.trim().replace(/^['"]|['"]$/g, "")))];
  if (urls.length !== 1) {
    throw new Error(`Google Fonts returned ${urls.length} font files; expected exactly one full-coverage font file`);
  }
  return urls[0]!;
}

export async function downloadGoogleFont(
  family: string,
  weight: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Buffer; extension: string }> {
  const cssResponse = await fetchImpl(googleCssUrl(family, weight));
  if (!cssResponse.ok) throw new Error(`Google Fonts CSS request failed: HTTP ${cssResponse.status}`);
  const fontUrl = extractSingleFontUrl(await cssResponse.text());
  const extension = extensionOrThrow(new URL(fontUrl).pathname);
  const fontResponse = await fetchImpl(fontUrl);
  if (!fontResponse.ok) throw new Error(`Google Fonts download failed: HTTP ${fontResponse.status}`);
  return { bytes: Buffer.from(await fontResponse.arrayBuffer()), extension };
}

function isManagedFontPath(projectDir: string, assetPath: string): string | undefined {
  const fontsDir = join(projectDir, "assets", "fonts");
  const absolute = resolve(projectDir, assetPath);
  const fromFontsDir = relative(fontsDir, absolute);
  return !isAbsolute(fromFontsDir) && fromFontsDir !== ".." && !fromFontsDir.startsWith("../")
    ? absolute
    : undefined;
}

export async function runFontCommand(
  projectPath: string,
  args: string[],
  flags: Record<string, string>,
  dependencies: FontCommandDependencies = {},
): Promise<string> {
  const action = resolveFontAction(args, flags);
  const project = await loadProjectFile(projectPath);
  if (action.kind === "list") return formatFontList(project);

  if (action.kind === "rm") {
    const font = findFont(project, action.family, action.weight);
    if (!font) throw new Error(`Font "${action.family}" ${action.weight} is not registered`);
    const nextProject = { ...project, fonts: project.fonts.filter((entry) => entry !== font) };
    await writeProjectFile(projectPath, nextProject);

    const managedPath = isManagedFontPath(dirname(projectPath), font.path);
    if (managedPath && !nextProject.fonts.some((entry) => entry.path === font.path)) {
      await unlink(managedPath).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      });
    }
    return formatFontList(nextProject);
  }

  if (findFont(project, action.family, action.weight)) {
    throw new Error(`Font "${action.family}" ${action.weight} is already registered`);
  }

  const projectDir = dirname(projectPath);
  let extension: string;
  let bytes: Buffer | undefined;
  if (action.source === "uploaded") {
    extension = extensionOrThrow(action.file);
    if (!await exists(action.file)) throw new Error(`Font file not found: ${action.file}`);
  } else {
    const downloaded = await downloadGoogleFont(action.family, action.weight, dependencies.fetch);
    extension = downloaded.extension;
    bytes = downloaded.bytes;
  }

  const path = targetAssetPath(action.family, action.weight, extension);
  const target = join(projectDir, path);
  if (await exists(target)) throw new Error(`Refusing to overwrite existing font file: ${target}`);
  await mkdir(dirname(target), { recursive: true });
  if (bytes) await writeFile(target, bytes);
  else await copyFile(action.file, target);

  const nextProject = {
    ...project,
    fonts: [...project.fonts, { family: action.family, source: action.source, path, weight: action.weight }],
  };
  await writeProjectFile(projectPath, nextProject);
  return formatFontList(nextProject);
}
