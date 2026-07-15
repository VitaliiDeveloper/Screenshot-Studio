// SPDX-License-Identifier: Apache-2.0
import { extname } from "node:path";
import { create, type Font, type FontCollection } from "fontkit";

export type SupportedFontFormat = "ttf" | "otf" | "woff" | "woff2";

export interface ParsedFontIdentity {
  format: SupportedFontFormat;
  family: string;
  postscriptName: string;
}

export class FontValidationError extends Error {
  readonly filename?: string;

  constructor(message: string);
  constructor(filename: string, message: string, options?: ErrorOptions);
  constructor(filenameOrMessage: string, message?: string, options?: ErrorOptions) {
    super(message === undefined
      ? filenameOrMessage
      : `Invalid font file "${filenameOrMessage}": ${message}`, options);
    this.name = "FontValidationError";
    if (message !== undefined) this.filename = filenameOrMessage;
  }
}

const supportedExtensions = new Set<SupportedFontFormat>([
  "ttf",
  "otf",
  "woff",
  "woff2",
]);

function extensionFor(filename: string): SupportedFontFormat {
  const extension = extname(filename).slice(1).toLowerCase();
  if (!supportedExtensions.has(extension as SupportedFontFormat)) {
    throw new FontValidationError(
      filename,
      "expected a .ttf, .otf, .woff, or .woff2 file",
    );
  }
  return extension as SupportedFontFormat;
}

function containerFor(bytes: Buffer, filename: string): SupportedFontFormat {
  if (bytes.length < 4) {
    throw new FontValidationError(filename, "the file is empty or truncated");
  }

  const signature = bytes.toString("ascii", 0, 4);
  if (signature === "OTTO") return "otf";
  if (signature === "wOFF") return "woff";
  if (signature === "wOF2") return "woff2";
  if (
    bytes.readUInt32BE(0) === 0x0001_0000
    || signature === "true"
    || signature === "typ1"
  ) {
    return "ttf";
  }

  throw new FontValidationError(filename, "the bytes are not a supported font container");
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`missing ${label}`);
  }
  return value.trim();
}

function forceEssentialTables(font: Font): {
  family: string;
  postscriptName: string;
} {
  const family = requireString(font.familyName, "font family metadata");
  const postscriptName = requireString(font.postscriptName, "PostScript name metadata");

  if (!Number.isInteger(font.numGlyphs) || font.numGlyphs <= 0) {
    throw new Error("invalid glyph count");
  }
  if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0) {
    throw new Error("invalid units-per-em metadata");
  }

  // Accessing a concrete outline forces fontkit to decode the glyph/CFF table,
  // rather than accepting a container based only on its header and name table.
  void font.getGlyph(0).path.commands;
  void font.characterSet;

  return { family, postscriptName };
}

function isFontCollection(font: Font | FontCollection): font is FontCollection {
  return font.type === "TTC" || font.type === "DFont";
}

export function parseSupportedFont(
  bytes: Uint8Array,
  filename: string,
): ParsedFontIdentity {
  const expectedFormat = extensionFor(filename);
  const buffer = Buffer.from(bytes);
  const parsedFormat = containerFor(buffer, filename);

  if (expectedFormat !== parsedFormat) {
    throw new FontValidationError(
      filename,
      `the .${expectedFormat} extension does not match the ${parsedFormat.toUpperCase()} container`,
    );
  }

  try {
    const parsed = create(buffer);
    if (isFontCollection(parsed)) {
      throw new Error("font collections are not supported");
    }
    const identity = forceEssentialTables(parsed);
    return {
      format: parsedFormat,
      family: identity.family,
      postscriptName: identity.postscriptName,
    };
  } catch (error) {
    if (error instanceof FontValidationError) throw error;
    throw new FontValidationError(
      filename,
      error instanceof Error ? error.message : "font parsing failed",
      { cause: error },
    );
  }
}
