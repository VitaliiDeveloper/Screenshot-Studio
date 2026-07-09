import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, parse, relative } from "node:path";
import { posix } from "node:path";
import {
  addScreenToProject,
  createScreenshotElement,
  parseScreenPlacement,
  slugify,
  uniqueId,
} from "@screenshot-studio/core/model";
import { inspectPng } from "@screenshot-studio/core/export";
import { loadProjectFile, writeProjectFile } from "./project-io.js";

export interface ImportCapturesOptions {
  projectPath: string;
  inputDir: string;
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

function displayDevice(device: string): string {
  if (device === "iphone") return "iPhone";
  if (device === "ipad") return "iPad";
  return device.slice(0, 1).toUpperCase() + device.slice(1);
}

async function collectCaptureFiles(inputDir: string): Promise<CaptureFile[]> {
  const captures: CaptureFile[] = [];
  const platforms = await readdir(inputDir, { withFileTypes: true }).catch(() => []);
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
            relativePath: relative(inputDir, sourcePath).split(posix.sep).join(posix.sep),
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
}: ImportCapturesOptions): Promise<ImportCapturesResult> {
  let project = await loadProjectFile(projectPath);
  const captures = await collectCaptureFiles(inputDir);
  const projectDir = dirname(projectPath);
  const warnings: string[] = [];
  let imported = 0;

  for (const capture of captures) {
    const placement = parseScreenPlacement(capture.platform, capture.device);
    if (!placement) {
      warnings.push(`Skipping unsupported capture path "${capture.relativePath}"`);
      continue;
    }

    const png = inspectPng(await readFile(capture.sourcePath));
    const assetUrl = posix.join(
      "assets",
      "imports",
      capture.platform,
      capture.device,
      capture.locale,
      capture.filename,
    );
    const targetPath = join(projectDir, assetUrl);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(capture.sourcePath, targetPath);

    const stem = parse(capture.filename).name;
    // Resolve the final unique screen id first so the element id stays deterministic after collisions.
    const screenId = uniqueId(
      slugify(`${capture.platform}-${capture.device}-${capture.locale}-${stem}`),
      project.screens,
    );
    const name = `${capture.platform.slice(0, 1).toUpperCase()}${capture.platform.slice(1)} ${displayDevice(
      capture.device,
    )} ${capture.locale} ${stem}`;

    project = addScreenToProject(project, {
      ...placement,
      id: screenId,
      name,
      locale: capture.locale,
      artboard: { width: png.width, height: png.height },
      elements: [
        createScreenshotElement({
          id: `${screenId}-screenshot`,
          x: 0,
          y: 0,
          width: png.width,
          height: png.height,
          assetUrl,
        }),
      ],
    });
    imported += 1;
  }

  await writeProjectFile(projectPath, project);
  return { imported, warnings };
}
