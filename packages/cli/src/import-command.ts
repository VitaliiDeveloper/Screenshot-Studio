import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, parse, relative } from "node:path";
import { posix } from "node:path";
import {
  Project,
  SCREEN_DEVICES_BY_PLATFORM,
  type Project as ProjectModel,
  type Screen,
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

function isSupportedDevice(platform: string, device: string): boolean {
  const devices = SCREEN_DEVICES_BY_PLATFORM[platform as keyof typeof SCREEN_DEVICES_BY_PLATFORM];
  return Boolean(devices?.includes(device as never));
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "screen"
  );
}

function uniqueId(base: string, screens: Screen[]): string {
  const used = new Set(screens.map((screen) => screen.id));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
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

function recomputeManifests(project: ProjectModel): ProjectModel {
  const platforms = Array.from(new Set(project.screens.map((screen) => screen.platform)));
  const locales = Array.from(new Set(project.screens.map((screen) => screen.locale)));
  return Project.parse({ ...project, platforms, locales });
}

export async function importCaptures({
  projectPath,
  inputDir,
}: ImportCapturesOptions): Promise<ImportCapturesResult> {
  const project = await loadProjectFile(projectPath);
  const captures = await collectCaptureFiles(inputDir);
  const projectDir = dirname(projectPath);
  const warnings: string[] = [];
  const screens = [...project.screens];

  for (const capture of captures) {
    if (!isSupportedDevice(capture.platform, capture.device)) {
      warnings.push(`Skipping unsupported capture path "${capture.relativePath}"`);
      continue;
    }

    const png = inspectPng(await readFile(capture.sourcePath));
    const assetUrl = posix.join("assets", "imports", capture.platform, capture.device, capture.locale, capture.filename);
    const targetPath = join(projectDir, assetUrl);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(capture.sourcePath, targetPath);

    const stem = parse(capture.filename).name;
    const id = uniqueId(slugify(`${capture.platform}-${capture.device}-${capture.locale}-${stem}`), screens);
    screens.push({
      id,
      name: `${capture.platform.slice(0, 1).toUpperCase()}${capture.platform.slice(1)} ${displayDevice(
        capture.device,
      )} ${capture.locale} ${stem}`,
      platform: capture.platform as Screen["platform"],
      device: capture.device as Screen["device"],
      locale: capture.locale,
      artboard: { width: png.width, height: png.height },
      background: { type: "solid", color: "#101827" },
      elements: [
        {
          id: `${id}-screenshot`,
          type: "screenshot",
          x: 0,
          y: 0,
          width: png.width,
          height: png.height,
          rotation: 0,
          opacity: 1,
          locked: false,
          visible: true,
          assetUrl,
          fit: "cover",
          cornerRadius: 0,
        },
      ],
    } as Screen);
  }

  const nextProject = recomputeManifests({ ...project, screens } as ProjectModel);
  await writeProjectFile(projectPath, nextProject);
  return { imported: screens.length - project.screens.length, warnings };
}
