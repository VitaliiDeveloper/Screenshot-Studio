// SPDX-License-Identifier: Apache-2.0
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { pruneStaleFastlaneFiles } from "./fastlane-prune.js";

const SCREENSHOTS = "fastlane/screenshots/en-US";
const IMAGES = "fastlane/metadata/android/en-US/images";

let root: string;
let outDir: string;
const log = vi.fn<(message: string) => void>();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fastlane-prune-"));
  outDir = join(root, "out");
  log.mockClear();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function plant(...relativePaths: string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    const path = join(outDir, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "png");
  }
}

async function exists(relativePath: string): Promise<boolean> {
  return access(join(outDir, relativePath)).then(() => true, () => false);
}

function prune(published: string[] = []): Promise<void> {
  return pruneStaleFastlaneFiles({ outDir, published, specs: DEFAULT_STORE_SPECS, log });
}

function messages(): string[] {
  return log.mock.calls.map(([message]) => message);
}

describe("pruneStaleFastlaneFiles", () => {
  it("removes generated App Store screenshots the export no longer produces and logs each", async () => {
    const kept = `${SCREENSHOTS}/01_hero_iphone-6.3.png`;
    const deleted = `${SCREENSHOTS}/06_settings_iphone-6.3.png`;
    const renamed = `${SCREENSHOTS}/01_old-name_iphone-6.3.png`;
    await plant(kept, deleted, renamed);

    await prune([kept]);

    expect(await exists(kept)).toBe(true);
    expect(await exists(deleted)).toBe(false);
    expect(await exists(renamed)).toBe(false);
    expect(messages().sort()).toEqual([
      `Removed stale ${join(outDir, renamed)}`,
      `Removed stale ${join(outDir, deleted)}`,
    ].sort());
  });

  it("removes generated Google Play images the export no longer produces", async () => {
    const kept = `${IMAGES}/phoneScreenshots/01.png`;
    const stale = [
      `${IMAGES}/phoneScreenshots/02.png`,
      `${IMAGES}/sevenInchScreenshots/01.png`,
    ];
    await plant(kept, ...stale);

    await prune([kept]);

    expect(await exists(kept)).toBe(true);
    for (const path of stale) expect(await exists(path)).toBe(false);
  });

  it("keeps an unpublished Feature Graphic with a warning, because it may be the user's", async () => {
    const featureGraphic = `${IMAGES}/featureGraphic.png`;
    await plant(featureGraphic);

    await prune();

    expect(await exists(featureGraphic)).toBe(true);
    expect(messages()).toEqual([
      `Warning: kept ${join(outDir, featureGraphic)} because the export did not generate it; fastlane would upload it`,
    ]);
  });

  it("covers a store locale the project no longer has", async () => {
    const appStore = "fastlane/screenshots/de-DE/01_hero_iphone-6.3.png";
    const googlePlay = "fastlane/metadata/android/de-DE/images/phoneScreenshots/01.png";
    await plant(appStore, googlePlay);

    await prune();

    expect(await exists(appStore)).toBe(false);
    expect(await exists(googlePlay)).toBe(false);
  });

  it("does not remove a published path that differs only by case", async () => {
    const onDisk = `${IMAGES}/phoneScreenshots/01.PNG`;
    await plant(onDisk);

    await prune([`${IMAGES}/phoneScreenshots/01.png`]);

    expect(await exists(onDisk)).toBe(true);
    expect(messages()).toEqual([]);
  });

  it("never touches listing text, changelogs, or the user's own listing images", async () => {
    const userFiles = [
      "fastlane/metadata/android/en-US/title.txt",
      "fastlane/metadata/android/en-US/changelogs/100.txt",
      "fastlane/metadata/android/en-US/01.png",
      `${IMAGES}/icon.png`,
      `${IMAGES}/tvBanner.png`,
      `${IMAGES}/customFolder/01.png`,
      `${SCREENSHOTS}/notes.txt`,
      "fastlane/metadata/en-US/description.txt",
      "fastlane/Fastfile",
    ];
    await plant(...userFiles);

    await prune();

    for (const path of userFiles) expect(await exists(path)).toBe(true);
    expect(messages()).toEqual([]);
  });

  it.each([
    "fastlane/screenshots/default/01_hero_iphone-6.3.png",
    "fastlane/screenshots/appleTV/en-US/01_hero_tvos-4k.png",
    "fastlane/screenshots/en-us/01_hero_iphone-6.3.png",
    "fastlane/metadata/android/default/images/phoneScreenshots/01.png",
    "other/screenshots/en-US/01_hero_iphone-6.3.png",
  ])("leaves %s alone because its folder is not a store locale", async (path) => {
    await plant(path);

    await prune();

    expect(await exists(path)).toBe(true);
    expect(messages()).toEqual([]);
  });

  it.each([
    `${SCREENSHOTS}/hero.png`,
    `${SCREENSHOTS}/1_hero_iphone-6.3.png`,
    `${SCREENSHOTS}/00_hero_iphone-6.3.png`,
    `${SCREENSHOTS}/001_hero_iphone-6.3.png`,
    `${SCREENSHOTS}/01_Hero_iphone-6.3.png`,
    `${SCREENSHOTS}/01_hero_iphone-6.3-dark.png`,
    `${SCREENSHOTS}/01_hero_phone-6.3.png`,
    `${SCREENSHOTS}/01_hero_iphone-6.3.jpg`,
    `${IMAGES}/phoneScreenshots/hero.png`,
    `${IMAGES}/phoneScreenshots/1.png`,
  ])("keeps %s and warns because fastlane would upload it", async (path) => {
    await plant(path);

    await prune();

    expect(await exists(path)).toBe(true);
    expect(messages()).toEqual([
      `Warning: kept ${join(outDir, path)} because the export did not generate it; fastlane would upload it`,
    ]);
  });

  it("keeps a symbolic link with a generated name and warns", async () => {
    const outside = join(root, "outside.png");
    await writeFile(outside, "png");
    await plant(`${SCREENSHOTS}/01_hero_iphone-6.3.png`);
    const linked = `${SCREENSHOTS}/02_hero_iphone-6.3.png`;
    await symlink(outside, join(outDir, linked));

    await prune([`${SCREENSHOTS}/01_hero_iphone-6.3.png`]);

    expect(await exists(linked)).toBe(true);
    expect(messages()).toEqual([expect.stringContaining(`Warning: kept ${join(outDir, linked)}`)]);
  });

  it("does not descend into a symbolic-link locale folder", async () => {
    const outside = join(root, "outside", "01_hero_iphone-6.3.png");
    await mkdir(dirname(outside), { recursive: true });
    await writeFile(outside, "png");
    await mkdir(join(outDir, "fastlane/screenshots"), { recursive: true });
    await symlink(dirname(outside), join(outDir, "fastlane/screenshots/en-US"));

    await prune();

    await expect(access(outside)).resolves.toBeUndefined();
    expect(messages()).toEqual([]);
  });

  it("fails closed on a symbolic-link ancestor below the locale folder", async () => {
    const outside = join(root, "outside", "01.png");
    await mkdir(dirname(outside), { recursive: true });
    await writeFile(outside, "png");
    await mkdir(join(outDir, IMAGES), { recursive: true });
    await symlink(dirname(outside), join(outDir, IMAGES, "phoneScreenshots"));

    await expect(prune()).rejects.toThrow(/symbolic link/i);

    await expect(access(outside)).resolves.toBeUndefined();
  });

  it("does nothing when the fastlane tree is absent", async () => {
    await expect(prune()).resolves.toBeUndefined();
    expect(messages()).toEqual([]);
  });
});
