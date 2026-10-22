// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, posix, relative, sep, win32 } from "node:path";
import { create, type Font } from "fontkit";
import {
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  FONT_WEIGHT_STEP,
} from "@screenshot-studio/core/model";
import { inspectSupportedFont, type SupportedFontFormat } from "./font-validation.js";

export type SystemFontSource = "user" | "system";
export type SystemFontFormat = SupportedFontFormat | "ttc" | "otc" | "dfont";

export interface SystemFontRoot {
  dir: string;
  source: SystemFontSource;
}

export interface SystemFontCoverage {
  latin: boolean;
  latinExtA: boolean;
  cyrillic: boolean;
  greek: boolean;
}

/** One scanned face. It deliberately carries no filesystem path; callers address it by `id`. */
export interface SystemFontFace {
  id: string;
  family: string;
  weight: number | null;
  source: SystemFontSource;
  format: SystemFontFormat;
  coverage: SystemFontCoverage;
  unavailable?: string;
}

export interface SystemFontMetadata {
  family: string;
  weight: number | undefined;
  italic: boolean;
  variable: boolean;
  collection: boolean;
  fsType: number;
  coverage: SystemFontCoverage;
}

export type ReadSystemFontMetadata = (bytes: Buffer, fileName: string) => SystemFontMetadata[];

export interface SystemFontFile {
  face: SystemFontFace;
  fileName: string;
  bytes: Buffer;
}

export interface SystemFontScanner {
  list(): Promise<SystemFontFace[]>;
  read(id: string): Promise<SystemFontFile>;
}

export class SystemFontNotFoundError extends Error {
  override name = "SystemFontNotFoundError";
}

export class SystemFontUnavailableError extends Error {
  override name = "SystemFontUnavailableError";
}

/** Matches the 20 MB limit the font upload endpoint applies to every registered font. */
export const SYSTEM_FONT_MAX_BYTES = 20 * 1024 * 1024;

const SCANNED_EXTENSIONS = new Set(["ttf", "otf", "woff", "woff2", "ttc", "otc", "dfont"]);
const COLLECTION_EXTENSIONS = new Set(["ttc", "otc", "dfont"]);
const NO_COVERAGE: SystemFontCoverage = {
  latin: false,
  latinExtA: false,
  cyrillic: false,
  greek: false,
};

const COVERAGE_SAMPLES: Record<keyof SystemFontCoverage, string> = {
  latin: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  latinExtA: "ĀāĂăĄąĆćČčĎďĒēĘęĚěĞğĪīİıŁłŃńŇňŌōŐőŒœŘřŚśŞşŠšŤťŪūŮůŰűŹźŻżŽž",
  cyrillic: "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяЄєІіЇїҐґ",
  greek: "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρςστυφχψω",
};

const FS_TYPE_RESTRICTED = 0x0002;
const FS_TYPE_LESS_RESTRICTIVE = 0x0004 | 0x0008;

interface SystemFontRootEnvironment {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  home?: string;
}

/**
 * User roots are the current user's own font folders; machine-wide roots are `system` because their
 * contents may be OS-bundled or licensed to the machine, not to this project.
 */
export function systemFontRoots({
  platform = process.platform,
  env = process.env,
  home = homedir(),
}: SystemFontRootEnvironment = {}): SystemFontRoot[] {
  if (platform === "darwin") {
    return [
      { dir: "/System/Library/Fonts", source: "system" },
      { dir: "/Library/Fonts", source: "system" },
      { dir: posix.join(home, "Library", "Fonts"), source: "user" },
    ];
  }
  if (platform === "win32") {
    return [
      ...(env.WINDIR ? [{ dir: win32.join(env.WINDIR, "Fonts"), source: "system" as const }] : []),
      ...(env.LOCALAPPDATA
        ? [{ dir: win32.join(env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"), source: "user" as const }]
        : []),
    ];
  }
  return [
    { dir: "/usr/share/fonts", source: "system" },
    { dir: "/usr/local/share/fonts", source: "system" },
    { dir: posix.join(home, ".local", "share", "fonts"), source: "user" },
    { dir: posix.join(home, ".fonts"), source: "user" },
  ];
}

function covers(font: Font, sample: string): boolean {
  try {
    return [...sample].every((char) => font.hasGlyphForCodePoint(char.codePointAt(0)!));
  } catch {
    return false;
  }
}

function metadataOf(font: Font, collection: boolean): SystemFontMetadata {
  const os2 = font["OS/2"] as Font["OS/2"] | null | undefined;
  const fsType = os2?.fsType;
  return {
    family: (font.getName("preferredFamily", "en") ?? font.familyName).trim(),
    weight: os2?.usWeightClass,
    italic: Boolean(os2?.fsSelection.italic || os2?.fsSelection.oblique) || font.italicAngle !== 0,
    variable: Object.keys(font.variationAxes).length > 0,
    collection,
    fsType: (fsType?.noEmbedding ? 0x0002 : 0)
      | (fsType?.viewOnly ? 0x0004 : 0)
      | (fsType?.editable ? 0x0008 : 0),
    coverage: {
      latin: covers(font, COVERAGE_SAMPLES.latin),
      latinExtA: covers(font, COVERAGE_SAMPLES.latinExtA),
      cyrillic: covers(font, COVERAGE_SAMPLES.cyrillic),
      greek: covers(font, COVERAGE_SAMPLES.greek),
    },
  };
}

/** Reads faces with the same fontkit validation the project font registration path applies. */
export function readFontkitMetadata(bytes: Buffer, fileName: string): SystemFontMetadata[] {
  const extension = extname(fileName).slice(1).toLowerCase();
  if (COLLECTION_EXTENSIONS.has(extension) || bytes.toString("ascii", 0, 4) === "ttcf") {
    const collection = create(bytes);
    return ("fonts" in collection ? collection.fonts : [collection]).map((font) => metadataOf(font, true));
  }
  return [metadataOf(inspectSupportedFont(bytes, fileName).font, false)];
}

function validWeight(weight: number | undefined): weight is number {
  return weight !== undefined
    && Number.isInteger(weight)
    && weight >= FONT_WEIGHT_MIN
    && weight <= FONT_WEIGHT_MAX
    && weight % FONT_WEIGHT_STEP === 0;
}

function unavailableReason(metadata: SystemFontMetadata): string | undefined {
  if (metadata.collection) return "Font collections (TTC, OTC, DFont) are not supported yet";
  if (metadata.variable) return "Variable fonts are not supported yet";
  if (
    (metadata.fsType & FS_TYPE_RESTRICTED) !== 0
    && (metadata.fsType & FS_TYPE_LESS_RESTRICTIVE) === 0
  ) {
    return "The font license (Restricted License embedding) does not allow embedding";
  }
  if (!validWeight(metadata.weight)) {
    return `Weight ${metadata.weight ?? "(missing)"} is not a multiple of ${FONT_WEIGHT_STEP} from ${FONT_WEIGHT_MIN} to ${FONT_WEIGHT_MAX}; add the file with Upload and choose a weight`;
  }
  return undefined;
}

function isInside(root: string, path: string): boolean {
  const relation = relative(root, path);
  return relation !== "" && relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation);
}

interface ScannedFile {
  name: string;
  path: string;
  size: number;
}

interface ScanEntry {
  face: SystemFontFace;
  path: string;
  fileName: string;
  root: string;
}

/** Symlinked directories are never followed; symlinked files must resolve inside their root. */
async function* fontFiles(root: string): AsyncGenerator<ScannedFile> {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const dirents = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
      const candidate = join(directory, dirent.name);
      if (dirent.isDirectory()) {
        pending.push(candidate);
        continue;
      }
      if (
        !SCANNED_EXTENSIONS.has(extname(dirent.name).slice(1).toLowerCase())
        || !(dirent.isFile() || dirent.isSymbolicLink())
      ) continue;
      const path = await realpath(candidate).catch(() => undefined);
      if (!path || !isInside(root, path)) continue;
      const info = await stat(path).catch(() => undefined);
      if (info?.isFile()) yield { name: dirent.name, path, size: info.size };
    }
  }
}

function faceId(path: string, index: number): string {
  return `sf_${createHash("sha256").update(`${path}\0${index}`).digest("hex").slice(0, 32)}`;
}

async function describeFile(
  file: ScannedFile,
  root: SystemFontRoot,
  realRoot: string,
  readMetadata: ReadSystemFontMetadata,
): Promise<ScanEntry[]> {
  const format = extname(file.name).slice(1).toLowerCase() as SystemFontFormat;
  const entry = (index: number, face: Omit<SystemFontFace, "id" | "source" | "format">): ScanEntry => ({
    face: { id: faceId(file.path, index), source: root.source, format, ...face },
    path: file.path,
    fileName: file.name,
    root: realRoot,
  });
  const unreadable = (reason: string) => [entry(0, {
    family: basename(file.name, extname(file.name)),
    weight: null,
    coverage: NO_COVERAGE,
    unavailable: reason,
  })];

  if (file.size > SYSTEM_FONT_MAX_BYTES) return unreadable("Larger than 20 MB, the project font size limit");
  let bytes: Buffer;
  try {
    bytes = await readFile(file.path);
  } catch {
    return unreadable("The file cannot be read");
  }
  let metadata: SystemFontMetadata[];
  try {
    metadata = readMetadata(bytes, file.name);
  } catch (error) {
    return unreadable(error instanceof Error ? error.message : "The font file is invalid");
  }
  return metadata.flatMap((face, index) => {
    if (face.italic) return [];
    const unavailable = unavailableReason(face);
    return [entry(index, {
      family: face.family,
      weight: face.weight ?? null,
      coverage: face.coverage,
      ...(unavailable ? { unavailable } : {}),
    })];
  });
}

/** One entry per family and weight: usable beats disabled, then the user's own folders beat machine-wide ones. */
function preferred(entries: ScanEntry[]): ScanEntry[] {
  const rank = (entry: ScanEntry) => (entry.face.unavailable ? 2 : 0) + (entry.face.source === "user" ? 0 : 1);
  const seen = new Set<string>();
  return [...entries]
    .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path) || a.face.id.localeCompare(b.face.id))
    .filter(({ face }) => {
      if (face.weight === null) return true;
      const key = JSON.stringify([face.family, face.weight]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function scanSystemFonts(
  roots: SystemFontRoot[],
  readMetadata: ReadSystemFontMetadata,
): Promise<Map<string, ScanEntry>> {
  const entries: ScanEntry[] = [];
  for (const root of roots) {
    const realRoot = await realpath(root.dir).catch(() => undefined);
    if (!realRoot) continue;
    for await (const file of fontFiles(realRoot)) {
      entries.push(...await describeFile(file, root, realRoot, readMetadata));
    }
  }
  return new Map(preferred(entries).map((entry) => [entry.face.id, entry]));
}

export function createSystemFontScanner({
  roots = systemFontRoots(),
  readMetadata = readFontkitMetadata,
}: {
  roots?: SystemFontRoot[];
  readMetadata?: ReadSystemFontMetadata;
} = {}): SystemFontScanner {
  let scan: Promise<Map<string, ScanEntry>> | undefined;
  const entries = () => {
    scan ??= scanSystemFonts(roots, readMetadata).catch((error: unknown) => {
      scan = undefined;
      throw error;
    });
    return scan;
  };

  return {
    async list() {
      return [...(await entries()).values()]
        .map(({ face }) => face)
        .sort((a, b) => a.family.localeCompare(b.family) || (a.weight ?? 0) - (b.weight ?? 0) || a.id.localeCompare(b.id));
    },

    async read(id) {
      const entry = (await entries()).get(id);
      if (!entry) throw new SystemFontNotFoundError("Unknown system font id");
      if (entry.face.unavailable) throw new SystemFontUnavailableError(entry.face.unavailable);
      const gone = new SystemFontNotFoundError("The font file changed or was removed since it was scanned");
      // The path was contained when scanned; anything that now resolves elsewhere is rejected.
      const path = await realpath(entry.path).catch(() => undefined);
      if (path !== entry.path || !isInside(entry.root, path)) throw gone;
      const info = await stat(path).catch(() => undefined);
      if (!info?.isFile() || info.size > SYSTEM_FONT_MAX_BYTES) throw gone;
      return { face: entry.face, fileName: entry.fileName, bytes: await readFile(path) };
    },
  };
}
