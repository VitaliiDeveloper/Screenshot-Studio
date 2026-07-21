// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filterProjectImageAssets } from "@web/lib/project-assets.js";
import { listProjectImageAssets } from "@web/lib/project-assets.server.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function project(): Promise<{ dir: string; projectPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "project-assets-"));
  cleanup.push(dir);
  const projectPath = join(dir, "app-store-screenshots.json");
  await writeFile(projectPath, "{}");
  return { dir, projectPath };
}

describe("project image assets", () => {
  it("discovers supported images under assets and screenshots in stable path order", async () => {
    const { dir, projectPath } = await project();
    await mkdir(join(dir, "assets", "decor"), { recursive: true });
    await mkdir(join(dir, "screenshots", "apple", "iphone", "en"), { recursive: true });
    await writeFile(join(dir, "assets", "decor", "hero.WEBP"), "image");
    await writeFile(join(dir, "assets", "ignore.gif"), "image");
    await writeFile(join(dir, "screenshots", "apple", "iphone", "en", "01.png"), "image");

    await expect(listProjectImageAssets(projectPath)).resolves.toEqual([
      { path: "assets/decor/hero.WEBP", name: "hero.WEBP", source: "assets" },
      {
        path: "screenshots/apple/iphone/en/01.png",
        name: "01.png",
        source: "screenshots",
      },
    ]);
  });

  it("does not follow image or directory symlinks", async () => {
    const { dir, projectPath } = await project();
    const outside = await mkdtemp(join(tmpdir(), "project-assets-outside-"));
    cleanup.push(outside);
    await mkdir(join(dir, "assets"), { recursive: true });
    await writeFile(join(outside, "outside.png"), "outside");
    await symlink(join(outside, "outside.png"), join(dir, "assets", "linked.png"));
    await symlink(outside, join(dir, "screenshots"), "dir");

    await expect(listProjectImageAssets(projectPath)).resolves.toEqual([]);
  });

  it("filters by the complete project-relative path", () => {
    const assets = [
      { path: "assets/decor/hero.png", name: "hero.png", source: "assets" as const },
      { path: "screenshots/apple/en/01.png", name: "01.png", source: "screenshots" as const },
    ];
    expect(filterProjectImageAssets(assets, "APPLE").map((asset) => asset.path)).toEqual([
      "screenshots/apple/en/01.png",
    ]);
  });
});
