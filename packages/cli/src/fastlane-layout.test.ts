// SPDX-License-Identifier: Apache-2.0
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STORE_SPECS,
  findStoreTarget,
  parseExportProfile,
  type BundleEntry,
} from "@screenshot-studio/core/export";
import type { Screen } from "@screenshot-studio/core/model";
import { writeBundleOutputs } from "./bundle-publisher.js";
import { cleanupTemporaryRoots, pngBytes, workspace } from "./bundle-publisher-test-support.js";
import {
  appStoreConnectLocale,
  fastlaneBundleEntries,
  fastlaneSkippedSummary,
  googlePlayLocale,
} from "./fastlane-layout.js";

afterEach(cleanupTemporaryRoots);

function entry(platform: string, device: string, sizeId: string, locale: string, name: string): BundleEntry {
  return {
    screen: { id: name.toLowerCase(), name, platform, device, locale } as Screen,
    target: findStoreTarget(DEFAULT_STORE_SPECS, platform, device, sizeId),
    relativePath: "unused.png",
  };
}

const paths = (entries: BundleEntry[]) => entries.map(({ relativePath }) => relativePath);

describe("fastlane store locales", () => {
  it("maps project locales to App Store Connect and Google Play codes", () => {
    expect(["en", "en_us", "de", "uk", "ja", "ar", "zh-hans"].map(appStoreConnectLocale))
      .toEqual(["en-US", "en-US", "de-DE", "uk", "ja", "ar-SA", "zh-Hans"]);
    expect(["en", "de", "uk", "ja", "he", "es"].map(googlePlayLocale))
      .toEqual(["en-US", "de-DE", "uk", "ja-JP", "iw-IL", "es-ES"]);
  });

  it("rejects ambiguous, unknown, and path-like locale ids", () => {
    expect(() => appStoreConnectLocale("pt")).toThrow(/several App Store Connect locales \(pt-BR, pt-PT\)/);
    expect(() => googlePlayLocale("zh")).toThrow(/several Google Play locales/);
    for (const locale of ["..", "con", "en.", "en-US.", "de-AT", "en/US", ""]) {
      expect(() => appStoreConnectLocale(locale), locale).toThrow(/no App Store Connect locale code/);
      expect(() => googlePlayLocale(locale), locale).toThrow(/no Google Play locale code/);
    }
  });
});

describe("fastlaneBundleEntries", () => {
  it("lays out iPhone and iPad screens in one deliver locale folder with unique names", () => {
    const layout = fastlaneBundleEntries([
      entry("apple", "iphone", "6.9", "en", "Hero"),
      entry("apple", "iphone", "6.9", "en", "Sync"),
      entry("apple", "iphone", "6.5", "en", "Hero"),
      entry("apple", "ipad", "13", "en", "Hero"),
      entry("apple", "ipad", "12.9", "de", "Hero"),
      entry("apple", "visionos", "vision-pro", "en", "Hero"),
      entry("apple", "tvos", "4k", "en", "Hero"),
      entry("apple", "iphone", "duo-inner", "en", "Hero"),
    ]);
    expect(paths(layout.entries)).toEqual([
      "fastlane/screenshots/en-US/01_hero_iphone-6.9.png",
      "fastlane/screenshots/en-US/02_sync_iphone-6.9.png",
      "fastlane/screenshots/en-US/01_hero_iphone-6.5.png",
      "fastlane/screenshots/en-US/01_hero_ipad-13.png",
      "fastlane/screenshots/de-DE/01_hero_ipad-12.9.png",
      "fastlane/screenshots/en-US/01_hero_visionos-vision-pro.png",
      "fastlane/screenshots/en-US/01_hero_tvos-4k.png",
      "fastlane/screenshots/en-US/01_hero_iphone-duo-inner.png",
    ]);
    expect(layout.skipped).toEqual([]);
  });

  it("refuses an Apple TV 4K name deliver would read as Vision Pro", () => {
    expect(() => fastlaneBundleEntries([entry("apple", "tvos", "4k", "en", "Vision Board")]))
      .toThrow(/read as Vision Pro/);
    expect(paths(fastlaneBundleEntries([entry("apple", "tvos", "hd", "en", "Vision Board")]).entries))
      .toEqual(["fastlane/screenshots/en-US/01_vision-board_tvos-hd.png"]);
  });

  it("keeps path-like screen names inside safe filename tokens", () => {
    expect(paths(fastlaneBundleEntries([
      entry("apple", "iphone", "6.9", "en", "con"),
      entry("apple", "iphone", "6.9", "en", ".."),
    ]).entries)).toEqual([
      "fastlane/screenshots/en-US/01_con_iphone-6.9.png",
      "fastlane/screenshots/en-US/02_screen_iphone-6.9.png",
    ]);
  });

  it("lays out Android phone, tablets, and the Feature Graphic for supply", () => {
    const layout = fastlaneBundleEntries([
      entry("android", "phone", "phone-portrait", "uk", "Hero"),
      entry("android", "phone", "phone-landscape", "uk", "Wide"),
      entry("android", "phone", "play-feature-graphic", "uk", "Banner"),
      entry("android", "tablet-7", "tablet-portrait", "uk", "Hero"),
      entry("android", "tablet-10", "tablet-10-portrait", "en", "Hero"),
      entry("android", "tv", "tv-landscape", "en", "Hero"),
      entry("android", "wear", "wear-square", "en", "Hero"),
    ]);
    expect(paths(layout.entries)).toEqual([
      "fastlane/metadata/android/uk/images/phoneScreenshots/01.png",
      "fastlane/metadata/android/uk/images/phoneScreenshots/02.png",
      "fastlane/metadata/android/uk/images/featureGraphic.png",
      "fastlane/metadata/android/uk/images/sevenInchScreenshots/01.png",
      "fastlane/metadata/android/en-US/images/tenInchScreenshots/01.png",
      "fastlane/metadata/android/en-US/images/tvScreenshots/01.png",
      "fastlane/metadata/android/en-US/images/wearScreenshots/01.png",
    ]);
  });

  it("refuses a second Feature Graphic in one locale", () => {
    expect(() => fastlaneBundleEntries([
      entry("android", "phone", "play-feature-graphic", "en", "One"),
      entry("android", "phone", "play-feature-graphic", "en", "Two"),
    ])).toThrow(/more than one Google Play Feature Graphic/);
  });

  it("skips sizes fastlane does not upload and summarizes them", () => {
    const layout = fastlaneBundleEntries([
      entry("apple", "iphone", "6.9", "en", "Hero"),
      entry("windows", "desktop", "4k", "en", "Hero"),
      entry("web", "mobile", "mobile-portrait", "en", "Hero"),
      entry("web", "mobile", "mobile-portrait", "en", "Next"),
      entry("android", "chromebook", "chromebook-landscape", "en", "Hero"),
      entry("android", "automotive", "automotive-portrait", "en", "Hero"),
      entry("android", "xr", "xr-landscape", "en", "Hero"),
    ]);
    expect(layout.entries).toHaveLength(1);
    expect(fastlaneSkippedSummary(layout.skipped)).toBe(
      "Skipped 6 screenshots fastlane does not upload: windows/desktop (1), web/mobile (2), "
        + "android/chromebook (1), android/automotive (1), android/xr (1)",
    );
    expect(fastlaneSkippedSummary([])).toBeUndefined();
  });

  it("reports every unmapped locale before rendering and rejects two locales sharing a folder", () => {
    expect(() => fastlaneBundleEntries([
      entry("apple", "iphone", "6.9", "..", "Hero"),
      entry("android", "phone", "phone-portrait", "con", "Hero"),
    ])).toThrow(/Locale "\.\." has no App Store Connect locale code[\s\S]*Locale "con" has no Google Play/);
    expect(() => fastlaneBundleEntries([
      entry("apple", "iphone", "6.9", "en", "Hero"),
      entry("apple", "iphone", "6.9", "en-US", "Hero"),
    ])).toThrow(/"en" and "en-US" both map to App Store Connect locale "en-US"/);
  });

  it("stays out of the core profile list the web export API accepts", () => {
    expect(() => parseExportProfile("fastlane")).toThrow("Unsupported export profile: fastlane");
  });

  it("publishes a multi-destination project under one fastlane folder", async () => {
    const root = await workspace("fastlane-layout-");
    const layout = fastlaneBundleEntries([
      entry("apple", "iphone", "6.9", "en", "Hero"),
      entry("apple", "ipad", "13", "en", "Hero"),
      entry("android", "phone", "phone-portrait", "en", "Hero"),
      entry("android", "phone", "play-feature-graphic", "en", "Banner"),
    ]);
    await writeBundleOutputs({
      outDir: root,
      entries: layout.entries.map((item) => ({ entry: item, png: pngBytes() })),
    });

    const files = (await readdir(join(root, "fastlane"), { recursive: true, withFileTypes: true }))
      .filter((dirent) => dirent.isFile())
      .map((dirent) => relative(root, join(dirent.parentPath, dirent.name)))
      .sort();
    expect(files).toEqual([
      "fastlane/metadata/android/en-US/images/featureGraphic.png",
      "fastlane/metadata/android/en-US/images/phoneScreenshots/01.png",
      "fastlane/screenshots/en-US/01_hero_ipad-13.png",
      "fastlane/screenshots/en-US/01_hero_iphone-6.9.png",
    ]);
  });
});
