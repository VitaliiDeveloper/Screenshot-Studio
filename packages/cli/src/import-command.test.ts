// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { inspectPng } from "@screenshot-studio/core/export";
import type { ProjectFileDependencies } from "@screenshot-studio/core/storage";
import {
  collectCaptureImportDirectory,
  importCaptures,
  previewCaptures,
} from "./import-command.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function importedCapturePath(screenId: string, bytes: Uint8Array): string {
  return `assets/imports/${screenId}-${digest(bytes).slice(0, 12)}.png`;
}

function sampleProject(): Project {
  return {
    meta: { name: "Import Project", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [
      {
        id: "default",
        name: "Default",
        mode: "isolated",
        screens: [
          {
            id: "hero",
            name: "Hero",
            platform: "apple",
            device: "iphone",
            locale: "en",
            direction: "ltr",
            artboard: { width: 1320, height: 2868 },
            background: { type: "solid", color: "#101827" },
            elements: [],
          },
        ],
      },
    ],
  };
}

describe("importCaptures", () => {
  it("imports supported PNG captures as screenshot screens", async () => {
    const dir = await workspace("screenshot-studio-import-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const inputDir = join(dir, "screenshots");
    await writeFile(projectPath, `${JSON.stringify(sampleProject(), null, 2)}\n`, "utf8");
    await mkdir(join(inputDir, "apple", "iphone", "en"), { recursive: true });
    await mkdir(join(inputDir, "android", "tablet-7", "en"), { recursive: true });
    const png = await readFile(new URL("../../../fixtures/regressions/screenshot-parity/assets/shot.png", import.meta.url));
    const pngInfo = inspectPng(png);
    await writeFile(join(inputDir, "apple", "iphone", "en", "01.png"), png);
    await writeFile(join(inputDir, "android", "tablet-7", "en", "01.png"), png);

    const result = await importCaptures({ projectPath, inputDir });

    expect(result.imported).toBe(2);
    expect(result.warnings).toEqual([]);
    const iphoneAssetUrl = importedCapturePath("apple-iphone-en-01", png);
    const tabletAssetUrl = importedCapturePath("android-tablet-7-en-01", png);
    await expect(readFile(join(dir, iphoneAssetUrl))).resolves.toEqual(png);
    await expect(readFile(join(dir, tabletAssetUrl))).resolves.toEqual(png);

    const written = JSON.parse(await readFile(projectPath, "utf8")) as Project;
    const screens = written.layouts[0]!.screens;
    expect(screens.map((screen) => screen.id)).toEqual([
      "hero",
      "android-tablet-7-en-01",
      "apple-iphone-en-01",
    ]);
    expect(screens[1]).toMatchObject({
      id: "android-tablet-7-en-01",
      name: "Google Play · Android tablet · en · 01",
      platform: "android",
      device: "tablet-7",
      locale: "en",
      direction: "ltr",
      artboard: { width: pngInfo.width, height: pngInfo.height },
      elements: [
        {
          id: "android-tablet-7-en-01-screenshot",
          type: "screenshot",
          x: 0,
          y: 0,
          width: pngInfo.width,
          height: pngInfo.height,
          assetUrl: tabletAssetUrl,
          fit: "cover",
        },
      ],
    });
    expect(screens[2]).toMatchObject({
      id: "apple-iphone-en-01",
      name: "App Store · iPhone · en · 01",
      platform: "apple",
      device: "iphone",
      locale: "en",
      direction: "ltr",
      artboard: { width: pngInfo.width, height: pngInfo.height },
      elements: [
        {
          id: "apple-iphone-en-01-screenshot",
          type: "screenshot",
          x: 0,
          y: 0,
          width: pngInfo.width,
          height: pngInfo.height,
          assetUrl: iphoneAssetUrl,
          fit: "cover",
        },
      ],
    });
  });

  it("previews the planned receiving layout and performs no Project or resource writes", async () => {
    const dir = await workspace("screenshot-studio-import-preview-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const inputDir = join(dir, "screenshots");
    const exactProject = `${JSON.stringify(sampleProject())}  \n`;
    const capturePath = join(inputDir, "apple", "iphone", "en", "01.png");
    const png = await readFile(new URL("../../../fixtures/regressions/screenshot-parity/assets/shot.png", import.meta.url));
    await writeFile(projectPath, exactProject, "utf8");
    await mkdir(join(inputDir, "apple", "iphone", "en"), { recursive: true });
    await writeFile(capturePath, png);

    const preview = await previewCaptures({ projectPath, inputDir, layout: "default" });

    expect(preview.receiving).toEqual({
      kind: "current-project",
      projectName: "Import Project",
      layoutId: "default",
      layoutName: "Default",
    });
    expect(preview.screens).toMatchObject([{
      sourcePath: "apple/iphone/en/01.png",
      screenId: "apple-iphone-en-01",
      resourcePath: importedCapturePath("apple-iphone-en-01", png),
    }]);
    expect(await readFile(projectPath, "utf8")).toBe(exactProject);
    await expect(readFile(join(dir, preview.screens[0]!.resourcePath))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("accepts the documented project root and copies supported related assets", async () => {
    const dir = await workspace("screenshot-studio-import-project-root-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const captureDir = join(dir, "screenshots", "android", "phone", "es");
    const sourceAsset = join(dir, "assets", "icons", "product.png");
    const png = await readFile(new URL("../../../fixtures/regressions/screenshot-parity/assets/shot.png", import.meta.url));
    await writeFile(projectPath, `${JSON.stringify(sampleProject(), null, 2)}\n`, "utf8");
    await mkdir(captureDir, { recursive: true });
    await mkdir(join(dir, "assets", "icons"), { recursive: true });
    await writeFile(join(captureDir, "03.png"), png);
    await writeFile(sourceAsset, new Uint8Array([9, 8, 7]));

    const preview = await previewCaptures({ projectPath, inputDir: dir });

    expect(preview.screens).toMatchObject([{
      sourcePath: "screenshots/android/phone/es/03.png",
      screenId: "android-phone-es-03",
    }]);
    expect(preview.resources.map(({ sourcePath, destinationPath }) => ({
      sourcePath,
      destinationPath,
    }))).toContainEqual({
      sourcePath: "assets/icons/product.png",
      destinationPath: "assets/icons/product.png",
    });
  });

  it("marks a different existing receiver asset invalid during no-write preview", async () => {
    const receiver = await workspace("screenshot-studio-import-receiver-conflict-");
    const source = await workspace("screenshot-studio-import-source-conflict-");
    const projectPath = join(receiver, "app-store-screenshots.json");
    const receiverAsset = join(receiver, "assets", "icons", "product.png");
    const sourceAsset = join(source, "assets", "icons", "product.png");
    const captureDir = join(source, "screenshots", "apple", "iphone", "en");
    const png = await readFile(new URL("../../../fixtures/regressions/screenshot-parity/assets/shot.png", import.meta.url));
    await writeFile(projectPath, `${JSON.stringify(sampleProject(), null, 2)}\n`, "utf8");
    await mkdir(join(receiver, "assets", "icons"), { recursive: true });
    await mkdir(join(source, "assets", "icons"), { recursive: true });
    await mkdir(captureDir, { recursive: true });
    await writeFile(receiverAsset, "receiver bytes");
    await writeFile(sourceAsset, "different source bytes");
    await writeFile(join(captureDir, "01.png"), png);

    const preview = await previewCaptures({ projectPath, inputDir: source });

    expect(preview.canApply).toBe(false);
    expect(preview.invalidEntries).toContainEqual({
      code: "destination-conflict",
      path: "assets/icons/product.png",
      message: expect.stringMatching(/already exists.*different bytes/i),
    });
    await expect(readFile(receiverAsset, "utf8")).resolves.toBe("receiver bytes");

    await writeFile(receiverAsset, "different source bytes");
    const matchingPreview = await previewCaptures({ projectPath, inputDir: source });
    expect(matchingPreview.canApply).toBe(true);
    expect(matchingPreview.invalidEntries).not.toContainEqual(expect.objectContaining({
      code: "destination-conflict",
      path: "assets/icons/product.png",
    }));
  });

  it("rejects symbolic links in capture input without rewriting the Project", async () => {
    const dir = await workspace("screenshot-studio-import-input-link-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const inputDir = join(dir, "screenshots");
    const captureDir = join(inputDir, "apple", "iphone", "en");
    const exactProject = `${JSON.stringify(sampleProject())}  \n`;
    const png = await readFile(new URL("../../../fixtures/regressions/screenshot-parity/assets/shot.png", import.meta.url));
    const outside = join(dir, "outside.png");
    await writeFile(projectPath, exactProject, "utf8");
    await writeFile(outside, png);
    await mkdir(captureDir, { recursive: true });
    await symlink(outside, join(captureDir, "01.png"));

    await expect(previewCaptures({ projectPath, inputDir })).rejects.toThrow(/symbolic link/i);
    expect(await readFile(projectPath, "utf8")).toBe(exactProject);
  });

  it("enforces file and byte limits while enumerating before discovery", async () => {
    const dir = await workspace("screenshot-studio-import-input-limits-");
    const captureDir = join(dir, "apple", "iphone", "en");
    await mkdir(captureDir, { recursive: true });
    await writeFile(join(captureDir, "01.png"), new Uint8Array([1, 2, 3]));
    await writeFile(join(captureDir, "02.png"), new Uint8Array([4, 5, 6]));

    await expect(collectCaptureImportDirectory(dir, {
      maxFiles: 1,
      maxBytes: 10,
      maxPathBytes: 1_024,
    })).rejects.toThrow(/file limit/i);
    await expect(collectCaptureImportDirectory(dir, {
      maxFiles: 2,
      maxBytes: 5,
      maxPathBytes: 1_024,
    })).rejects.toThrow(/byte limit/i);
  });

  it("bounds directory-only fan-out while enumerating", async () => {
    const dir = await workspace("screenshot-studio-import-input-entries-");
    await mkdir(join(dir, "one"));
    await mkdir(join(dir, "two"));
    await mkdir(join(dir, "three"));

    await expect(collectCaptureImportDirectory(dir, {
      maxEntries: 2,
    })).rejects.toThrow(/entry limit/i);
  });

  it("uses a collision-resolved screen id for the screenshot element id", async () => {
    const dir = await workspace("screenshot-studio-import-collide-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const inputDir = join(dir, "screenshots");
    const existing = sampleProject();
    existing.layouts[0]!.screens.push({
      id: "apple-iphone-en-01",
      name: "Existing",
      platform: "apple",
      device: "iphone",
      locale: "en",
      direction: "ltr",
      artboard: { width: 1320, height: 2868 },
      background: { type: "solid", color: "#101827" },
      elements: [],
    });
    await writeFile(projectPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
    await mkdir(join(inputDir, "apple", "iphone", "en"), { recursive: true });
    const png = await readFile(new URL("../../../fixtures/regressions/screenshot-parity/assets/shot.png", import.meta.url));
    await writeFile(join(inputDir, "apple", "iphone", "en", "01.png"), png);

    await importCaptures({ projectPath, inputDir });

    const written = JSON.parse(await readFile(projectPath, "utf8")) as Project;
    const imported = written.layouts[0]!.screens.find((screen) => screen.id === "apple-iphone-en-01-2");
    expect(imported?.elements[0]?.id).toBe("apple-iphone-en-01-2-screenshot");
  });

  it("fails when the input root is missing instead of silently rewriting the project", async () => {
    const dir = await workspace("screenshot-studio-import-missing-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const exactProject = `${JSON.stringify(sampleProject())}  \n`;
    await writeFile(projectPath, exactProject, "utf8");

    await expect(importCaptures({
      projectPath,
      inputDir: join(dir, "missing"),
    })).rejects.toMatchObject({ code: "ENOENT" });

    expect(await readFile(projectPath, "utf8")).toBe(exactProject);
  });

  it("does not rewrite exact project bytes for an empty input root", async () => {
    const dir = await workspace("screenshot-studio-import-empty-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const inputDir = join(dir, "screenshots");
    const exactProject = `${JSON.stringify(sampleProject())}  \n`;
    await writeFile(projectPath, exactProject, "utf8");
    await mkdir(inputDir);

    await expect(importCaptures({ projectPath, inputDir })).resolves.toEqual({
      imported: 0,
      warnings: [],
    });

    expect(await readFile(projectPath, "utf8")).toBe(exactProject);
  });

  it("rolls back a newly published content-addressed asset when the project write fails", async () => {
    const dir = await workspace("screenshot-studio-import-rollback-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const inputDir = join(dir, "screenshots");
    const captureDir = join(inputDir, "apple", "iphone", "en");
    const png = await readFile(new URL("../../../fixtures/regressions/screenshot-parity/assets/shot.png", import.meta.url));
    const assetRelativePath = importedCapturePath("apple-iphone-en-01", png);
    const assetPath = join(dir, assetRelativePath);
    await writeFile(projectPath, `${JSON.stringify(sampleProject(), null, 2)}\n`, "utf8");
    await mkdir(captureDir, { recursive: true });
    await writeFile(join(captureDir, "01.png"), png);
    const writeFailure = new Error("project write failed");
    const projectFileDependencies: ProjectFileDependencies = {
      beforeDestinationRevalidation: async () => { throw writeFailure; },
    };
    await expect(importCaptures(
      { projectPath, inputDir },
      { projectFileDependencies },
    )).rejects.toBe(writeFailure);

    await expect(readFile(assetPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((JSON.parse(await readFile(projectPath, "utf8")) as Project).layouts[0]!.screens).toHaveLength(1);
  });

  it("does not remove a pre-existing exact asset when the project write fails", async () => {
    const dir = await workspace("screenshot-studio-import-existing-rollback-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const inputDir = join(dir, "screenshots");
    const captureDir = join(inputDir, "apple", "iphone", "en");
    const png = await readFile(new URL("../../../fixtures/regressions/screenshot-parity/assets/shot.png", import.meta.url));
    const assetPath = join(dir, importedCapturePath("apple-iphone-en-01", png));
    await writeFile(projectPath, `${JSON.stringify(sampleProject(), null, 2)}\n`, "utf8");
    await mkdir(captureDir, { recursive: true });
    await writeFile(join(captureDir, "01.png"), png);
    await mkdir(join(dir, "assets", "imports"), { recursive: true });
    await writeFile(assetPath, png);
    const writeFailure = new Error("project write failed");

    await expect(importCaptures(
      { projectPath, inputDir },
      {
        projectFileDependencies: {
          beforeDestinationRevalidation: async () => { throw writeFailure; },
        },
      },
    )).rejects.toBe(writeFailure);

    expect(await readFile(assetPath)).toEqual(png);
  });

  it("publishes imports beside the canonical project when invoked through a file symlink", async () => {
    const realDir = await workspace("screenshot-studio-import-real-");
    const aliasDir = await workspace("screenshot-studio-import-alias-");
    const canonicalProjectPath = join(realDir, "app-store-screenshots.json");
    const aliasProjectPath = join(aliasDir, "project-alias.json");
    const inputDir = join(aliasDir, "screenshots");
    const captureDir = join(inputDir, "apple", "iphone", "en");
    const png = await readFile(new URL("../../../fixtures/regressions/screenshot-parity/assets/shot.png", import.meta.url));
    const assetRelativePath = importedCapturePath("apple-iphone-en-01", png);
    await writeFile(canonicalProjectPath, `${JSON.stringify(sampleProject(), null, 2)}\n`, "utf8");
    await symlink(canonicalProjectPath, aliasProjectPath);
    await mkdir(captureDir, { recursive: true });
    await writeFile(join(captureDir, "01.png"), png);

    await importCaptures({ projectPath: aliasProjectPath, inputDir });

    expect(await readFile(join(realDir, assetRelativePath))).toEqual(png);
    await expect(readFile(join(aliasDir, assetRelativePath))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
