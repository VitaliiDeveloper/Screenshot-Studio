// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, parse, relative, sep } from "node:path";
import { posix } from "node:path";
import {
  addScreenToProject,
  createScreenshotElement,
  parseScreenPlacement,
  slugify,
  uniqueId,
  getLayout,
} from "@screenshot-studio/core/model";
import { inspectPng } from "@screenshot-studio/core/export";
import {
  resolveExistingProjectPath,
  type ProjectFileDependencies,
} from "@screenshot-studio/core/storage";
import { updateProjectFile } from "./project-io.js";
import {
  publishManagedResourceFile,
  removeManagedResourceFile,
} from "./managed-resource-file.js";
import { resolveMutationLayout } from "./layout-commands.js";

export interface ImportCapturesOptions {
  projectPath: string;
  inputDir: string;
  layout?: string;
}

export interface ImportCapturesResult {
  imported: number;
  warnings: string[];
}

interface CaptureFile {
  platform: string;
  device: string;
  locale: string;
  filename: string;
  sourcePath: string;
  relativePath: string;
}

interface ImportCapturesDependencies {
  projectFileDependencies?: ProjectFileDependencies;
  publishFile?: typeof publishManagedResourceFile;
  removeFile?: typeof removeManagedResourceFile;
}

interface PreparedCapture extends CaptureFile {
  placement: NonNullable<ReturnType<typeof parseScreenPlacement>>;
  png: Buffer;
  width: number;
  height: number;
  assetUrl: string;
}

function displayDevice(device: string): string {
  if (device === "iphone") return "iPhone";
  if (device === "ipad") return "iPad";
  return device.slice(0, 1).toUpperCase() + device.slice(1);
}

async function collectCaptureFiles(inputDir: string): Promise<CaptureFile[]> {
  const captures: CaptureFile[] = [];
  const platforms = await readdir(inputDir, { withFileTypes: true });
  for (const platformEntry of platforms) {
    if (!platformEntry.isDirectory()) continue;
    const platform = platformEntry.name;
    const platformDir = join(inputDir, platform);
    const devices = await readdir(platformDir, { withFileTypes: true });
    for (const deviceEntry of devices) {
      if (!deviceEntry.isDirectory()) continue;
      const device = deviceEntry.name;
      const deviceDir = join(platformDir, device);
      const locales = await readdir(deviceDir, { withFileTypes: true });
      for (const localeEntry of locales) {
        if (!localeEntry.isDirectory()) continue;
        const locale = localeEntry.name;
        const localeDir = join(deviceDir, locale);
        const files = await readdir(localeDir, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || !file.name.toLowerCase().endsWith(".png")) continue;
          const sourcePath = join(localeDir, file.name);
          captures.push({
            platform,
            device,
            locale,
            filename: file.name,
            sourcePath,
            relativePath: relative(inputDir, sourcePath).split(sep).join(posix.sep),
          });
        }
      }
    }
  }
  return captures.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function importCaptures({
  projectPath,
  inputDir,
  layout: layoutReference,
}: ImportCapturesOptions, {
  projectFileDependencies = {},
  publishFile = publishManagedResourceFile,
  removeFile = removeManagedResourceFile,
}: ImportCapturesDependencies = {}): Promise<ImportCapturesResult> {
  const canonicalProjectPath = await resolveExistingProjectPath(projectPath);
  const captures = await collectCaptureFiles(inputDir);
  const projectDir = dirname(canonicalProjectPath);
  const warnings: string[] = [];
  const prepared: PreparedCapture[] = [];

  for (const capture of captures) {
    const placement = parseScreenPlacement(capture.platform, capture.device);
    if (!placement) {
      warnings.push(`Skipping unsupported capture path "${capture.relativePath}"`);
      continue;
    }

    const bytes = await readFile(capture.sourcePath);
    const png = inspectPng(bytes);
    const revision = createHash("sha256").update(bytes).digest("hex");
    prepared.push({
      ...capture,
      placement,
      png: bytes,
      width: png.width,
      height: png.height,
      assetUrl: posix.join("assets", "imports", `${revision}.png`),
    });
  }

  const updated = await updateProjectFile(canonicalProjectPath, async (current, transaction) => {
    let project = current;
    const layoutId = resolveMutationLayout(current, layoutReference).id;
    for (const capture of prepared) {
      const publication = await publishFile({
        root: projectDir,
        relativePath: capture.assetUrl,
        bytes: capture.png,
      });
      if (publication.created) {
        transaction.onRollback(async () => {
          await removeFile(projectDir, capture.assetUrl, publication.ownership);
        });
      }

      const stem = parse(capture.filename).name;
      // Resolve the final unique screen id first so the element id stays deterministic after collisions.
      const screenId = uniqueId(
        slugify(`${capture.platform}-${capture.device}-${capture.locale}-${stem}`),
        getLayout(project, layoutId).screens,
      );
      const name = `${capture.platform.slice(0, 1).toUpperCase()}${capture.platform.slice(1)} ${displayDevice(
        capture.device,
      )} ${capture.locale} ${stem}`;

      project = addScreenToProject(project, layoutId, {
        ...capture.placement,
        id: screenId,
        name,
        locale: capture.locale,
        artboard: { width: capture.width, height: capture.height },
        elements: [
          createScreenshotElement({
            id: `${screenId}-screenshot`,
            x: 0,
            y: 0,
            width: capture.width,
            height: capture.height,
            assetUrl: capture.assetUrl,
          }),
        ],
      });
    }

    return {
      project,
      value: { imported: prepared.length, warnings },
    };
  }, {}, projectFileDependencies);
  return updated.value;
}
