// SPDX-License-Identifier: Apache-2.0
import { collectImageUrls } from "@screenshot-studio/core/assets";
import {
  isProjectRelativePath,
  isSensitiveProjectArchivePath,
  isTransientResourceBasename,
  type Project,
} from "@screenshot-studio/core/model";

export { isSensitiveProjectArchivePath };

const ROOT_FILES = new Set(["app-store-screenshots.json", "AGENTS.md", "CLAUDE.md"]);
const RESOURCE_ROOTS = new Set(["assets", "screenshots", "themes", "templates", "packs"]);
export function isSupportedProjectArchivePath(relativePath: string): boolean {
  if (!isProjectRelativePath(relativePath) || isSensitiveProjectArchivePath(relativePath)) return false;
  const segments = relativePath.split("/");
  if (segments.length === 1) return ROOT_FILES.has(relativePath);
  if (!RESOURCE_ROOTS.has(segments[0]!)) return false;
  return !isTransientResourceBasename(segments.at(-1)!);
}

export function collectRequiredProjectResourcePaths(project: Project): string[] {
  const paths = new Set(collectImageUrls(project));
  if (project.meta.appIcon) paths.add(project.meta.appIcon);
  for (const font of project.fonts) paths.add(font.path);
  return [...paths].sort((left, right) => left.localeCompare(right));
}
