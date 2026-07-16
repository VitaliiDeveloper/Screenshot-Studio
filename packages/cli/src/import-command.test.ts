// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { inspectPng } from "@screenshot-studio/core/export";
import type { ProjectFileDependencies } from "@screenshot-studio/core/storage";
import { importCaptures } from "./import-command.js";
import {
  publishFileSafelyWithOwnership,
  removeRegularFileSafely,
} from "./safe-file-publisher.js";

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

function sampleProject(): Project {
  return {
    meta: { name: "Import Project", schemaVersion: 1 },
    mode: "isolated",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
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

    expect(result.imported).toBe(1);
    expect(result.warnings).toEqual(['Skipping unsupported capture path "android/tablet-7/en/01.png"']);
    const assetUrl = `assets/imports/${digest(png)}.png`;
    await expect(readFile(join(dir, assetUrl))).resolves.toEqual(png);

    const written = JSON.parse(await readFile(projectPath, "utf8")) as Project;
    expect(written.screens.map((screen) => screen.id)).toEqual(["hero", "apple-iphone-en-01"]);
    expect(written.screens[1]).toMatchObject({
      id: "apple-iphone-en-01",
      name: "Apple iPhone en 01",
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
          assetUrl,
          fit: "cover",
        },
      ],
    });
  });

  it("uses a collision-resolved screen id for the screenshot element id", async () => {
    const dir = await workspace("screenshot-studio-import-collide-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const inputDir = join(dir, "screenshots");
    const existing = sampleProject();
    existing.screens.push({
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
    const imported = written.screens.find((screen) => screen.id === "apple-iphone-en-01-2");
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
    const assetPath = join(dir, "assets", "imports", `${digest(png)}.png`);
    await writeFile(projectPath, `${JSON.stringify(sampleProject(), null, 2)}\n`, "utf8");
    await mkdir(captureDir, { recursive: true });
    await writeFile(join(captureDir, "01.png"), png);
    const writeFailure = new Error("project write failed");
    const projectFileDependencies: ProjectFileDependencies = {
      beforeDestinationRevalidation: async () => { throw writeFailure; },
    };
    const publishFile = vi.fn(publishFileSafelyWithOwnership);
    const removeFile = vi.fn(removeRegularFileSafely);

    await expect(importCaptures(
      { projectPath, inputDir },
      { projectFileDependencies, publishFile, removeFile },
    )).rejects.toBe(writeFailure);

    const publication = await publishFile.mock.results[0]!.value;
    expect(removeFile).toHaveBeenCalledWith(
      await realpath(dir),
      `assets/imports/${digest(png)}.png`,
      publication.ownership,
    );
    await expect(readFile(assetPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((JSON.parse(await readFile(projectPath, "utf8")) as Project).screens).toHaveLength(1);
  });

  it("does not remove a pre-existing exact asset when the project write fails", async () => {
    const dir = await workspace("screenshot-studio-import-existing-rollback-");
    const projectPath = join(dir, "app-store-screenshots.json");
    const inputDir = join(dir, "screenshots");
    const captureDir = join(inputDir, "apple", "iphone", "en");
    const png = await readFile(new URL("../../../fixtures/regressions/screenshot-parity/assets/shot.png", import.meta.url));
    const assetPath = join(dir, "assets", "imports", `${digest(png)}.png`);
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
    const assetRelativePath = join("assets", "imports", `${digest(png)}.png`);
    await writeFile(canonicalProjectPath, `${JSON.stringify(sampleProject(), null, 2)}\n`, "utf8");
    await symlink(canonicalProjectPath, aliasProjectPath);
    await mkdir(captureDir, { recursive: true });
    await writeFile(join(captureDir, "01.png"), png);

    await importCaptures({ projectPath: aliasProjectPath, inputDir });

    expect(await readFile(join(realDir, assetRelativePath))).toEqual(png);
    await expect(readFile(join(aliasDir, assetRelativePath))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
