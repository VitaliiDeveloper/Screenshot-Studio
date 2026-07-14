// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

const SCHEME_OR_DRIVE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function isProjectRelativePath(value: string): boolean {
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0")) return false;
  if (SCHEME_OR_DRIVE.test(value)) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export const ProjectRelativePath = z.string().refine(
  isProjectRelativePath,
  "expected a portable project-relative path",
);
