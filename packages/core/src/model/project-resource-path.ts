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

export const ProjectRelativePath = z.string().refine(
  isProjectRelativePath,
  "expected a portable project-relative path",
);
