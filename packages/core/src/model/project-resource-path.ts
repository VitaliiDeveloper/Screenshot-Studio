// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

const SCHEME_OR_DRIVE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
// Project documents move across platforms, so every segment must also be creatable on Windows.
const WINDOWS_INVALID_CHARACTER = /[<>:"|?*]/u;
const WINDOWS_TRAILING_SPACE_OR_PERIOD = /[ .]$/u;
const WINDOWS_RESERVED_NAME =
  /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu;

function hasWindowsControlCharacter(segment: string): boolean {
  return [...segment].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint >= 1 && codePoint <= 31;
  });
}

function isPortablePathSegment(segment: string): boolean {
  if (segment === "" || segment === "." || segment === "..") return false;
  if (WINDOWS_INVALID_CHARACTER.test(segment) || hasWindowsControlCharacter(segment)) return false;
  if (WINDOWS_TRAILING_SPACE_OR_PERIOD.test(segment)) return false;
  return !WINDOWS_RESERVED_NAME.test(segment);
}

export function isProjectRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  if (SCHEME_OR_DRIVE.test(value)) return false;
  return value.split("/").every(isPortablePathSegment);
}

const CREDENTIAL_BASENAME =
  /(?:^|[-_.])(?:credentials?|secrets?|service-account|id_rsa|id_ed25519)(?:[-_.]|$)/iu;
const PRIVATE_EXTENSION = /\.(?:key|pem|p12|pfx|jks|keystore|mobileprovision)$/iu;
const TRANSIENT_BASENAME = /(?:^|\.)(?:lock|tmp|temp|stage)(?:\.|$)/iu;

/** Hidden, credential-like, and key-like paths never leave or enter a project archive. */
export function isSensitiveProjectArchivePath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment.startsWith("."))) return true;
  const basename = segments.at(-1)!;
  return CREDENTIAL_BASENAME.test(basename) || PRIVATE_EXTENSION.test(basename);
}

/** Lock, temp, and staging names that project archives skip as transient. */
export function isTransientResourceBasename(basename: string): boolean {
  return TRANSIENT_BASENAME.test(basename);
}

/** The only file types the editor and render host load from a project folder. */
export const PROJECT_ASSET_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".ttf", ".otf", ".woff", ".woff2"] as const;
export type ProjectAssetExtension = (typeof PROJECT_ASSET_EXTENSIONS)[number];

export const ProjectRelativePath = z.string().refine(
  isProjectRelativePath,
  "expected a portable project-relative path",
);
