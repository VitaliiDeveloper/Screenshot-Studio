// SPDX-License-Identifier: Apache-2.0
import { collectImageUrls } from "@screenshot-studio/core/assets";
import { isProjectRelativePath, type Project } from "@screenshot-studio/core/model";

const ROOT_FILES = new Set(["app-store-screenshots.json", "AGENTS.md", "CLAUDE.md"]);
const RESOURCE_ROOTS = new Set(["assets", "screenshots", "themes", "templates"]);
const CREDENTIAL_BASENAME =
  /(?:^|[-_.])(?:credentials?|secrets?|service-account|id_rsa|id_ed25519)(?:[-_.]|$)/iu;
const PRIVATE_EXTENSION = /\.(?:key|pem|p12|pfx|jks|keystore|mobileprovision)$/iu;
const TRANSIENT_BASENAME = /(?:^|\.)(?:lock|tmp|temp|stage)(?:\.|$)/iu;

export function isSensitiveProjectArchivePath(relativePath: string): boolean {
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment.startsWith("."))) return true;
  const basename = segments.at(-1)!;
  return CREDENTIAL_BASENAME.test(basename) || PRIVATE_EXTENSION.test(basename);
}

export function isSupportedProjectArchivePath(relativePath: string): boolean {
  if (!isProjectRelativePath(relativePath) || isSensitiveProjectArchivePath(relativePath)) return false;
  const segments = relativePath.split("/");
  if (segments.length === 1) return ROOT_FILES.has(relativePath);
  if (!RESOURCE_ROOTS.has(segments[0]!)) return false;
  return !TRANSIENT_BASENAME.test(segments.at(-1)!);
}

export function collectRequiredProjectResourcePaths(project: Project): string[] {
  const paths = new Set(collectImageUrls(project));
  if (project.meta.appIcon) paths.add(project.meta.appIcon);
  for (const font of project.fonts) paths.add(font.path);
  return [...paths].sort((left, right) => left.localeCompare(right));
}
