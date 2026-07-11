// SPDX-License-Identifier: Apache-2.0
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { inspectPng } from "@screenshot-studio/core/export";
import { importCaptures } from "./import-command.js";

function sampleProject(): Project {
  return {
    meta: { name: "Import Project", schemaVersion: 7 },
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
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-import-"));
    const projectPath = join(dir, "app-store-screenshots.json");
    const inputDir = join(dir, "screenshots");
    await writeFile(projectPath, `${JSON.stringify(sampleProject(), null, 2)}\n`, "utf8");
    await mkdir(join(inputDir, "apple", "iphone", "en"), { recursive: true });
    await mkdir(join(inputDir, "android", "tablet-7", "en"), { recursive: true });
    const png = await readFile(new URL("../../../fixtures/slice-2-screenshot/assets/shot.png", import.meta.url));
    const pngInfo = inspectPng(png);
    await writeFile(join(inputDir, "apple", "iphone", "en", "01.png"), png);
    await writeFile(join(inputDir, "android", "tablet-7", "en", "01.png"), png);

    const result = await importCaptures({ projectPath, inputDir });

    expect(result.imported).toBe(1);
    expect(result.warnings).toEqual(['Skipping unsupported capture path "android/tablet-7/en/01.png"']);
    await expect(readFile(join(dir, "assets", "imports", "apple", "iphone", "en", "01.png"))).resolves.toBeInstanceOf(Buffer);

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
          assetUrl: "assets/imports/apple/iphone/en/01.png",
          fit: "cover",
        },
      ],
    });
  });

  it("uses a collision-resolved screen id for the screenshot element id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "screenshot-studio-import-collide-"));
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
    const png = await readFile(new URL("../../../fixtures/slice-2-screenshot/assets/shot.png", import.meta.url));
    await writeFile(join(inputDir, "apple", "iphone", "en", "01.png"), png);

    await importCaptures({ projectPath, inputDir });

    const written = JSON.parse(await readFile(projectPath, "utf8")) as Project;
    const imported = written.screens.find((screen) => screen.id === "apple-iphone-en-01-2");
    expect(imported?.elements[0]?.id).toBe("apple-iphone-en-01-2-screenshot");
  });
});
