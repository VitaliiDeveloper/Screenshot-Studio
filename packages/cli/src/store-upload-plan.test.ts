// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildBundleEntries,
  DEFAULT_STORE_SPECS,
  findStoreTarget,
  type BundleEntry,
} from "@screenshot-studio/core/export";
import { Project, type Screen } from "@screenshot-studio/core/model";
import { appStoreUploadPlan, googlePlayUploadPlan } from "./store-upload-plan.js";

function entry(device: string, sizeId: string, locale: string, id: string, platform = "android"): BundleEntry {
  return {
    screen: { id, name: id, platform, device, locale } as Screen,
    target: findStoreTarget(DEFAULT_STORE_SPECS, platform, device, sizeId),
    relativePath: "unused.png",
  };
}

describe("googlePlayUploadPlan", () => {
  it("plans examples/connected-launch: one phone slot in en-US, every other family skipped", async () => {
    const raw = await readFile(new URL("../../../examples/connected-launch/app-store-screenshots.json", import.meta.url), "utf8");
    const project = Project.parse(JSON.parse(raw));
    const plan = googlePlayUploadPlan(buildBundleEntries(project, project.preferredExportLayoutId, DEFAULT_STORE_SPECS, {}));

    expect(plan.locales).toEqual([{
      locale: "en-US",
      projectLocale: "en",
      slots: [{
        imageType: "phoneScreenshots",
        upload: [expect.objectContaining({ relativePath: "en-US/phoneScreenshots/01.png" })],
        replace: null,
      }],
      untouchedSlots: ["sevenInchScreenshots", "tenInchScreenshots", "tvScreenshots", "wearScreenshots", "featureGraphic"],
    }]);
    expect(plan.untouchedLocales).toBeNull();
    expect(plan.entries.map(({ relativePath }) => relativePath)).toEqual(["en-US/phoneScreenshots/01.png"]);
    expect(plan.skipped.map(({ screen }) => `${screen.platform}/${screen.device}`))
      .toEqual(["apple/iphone", "apple/iphone", "apple/iphone", "web/desktop"]);
  });

  it("keeps project order per slot and fills replacements and untouched locales from the store", () => {
    const plan = googlePlayUploadPlan([
      entry("phone", "phone-portrait", "uk", "b"),
      entry("tablet-10", "tablet-10-landscape", "uk", "t"),
      entry("phone", "phone-portrait", "uk", "a"),
      entry("chromebook", "chromebook-landscape", "uk", "c"),
    ], {
      locales: ["uk", "de-DE"],
      images: new Map([["uk/phoneScreenshots", [{ id: "old-1" }, { id: "old-2" }]]]),
    });

    expect(plan.locales[0]!.slots).toEqual([
      expect.objectContaining({ imageType: "phoneScreenshots", replace: [{ id: "old-1" }, { id: "old-2" }] }),
      expect.objectContaining({ imageType: "tenInchScreenshots", replace: [] }),
    ]);
    expect(plan.locales[0]!.slots[0]!.upload.map(({ screenId }) => screenId)).toEqual(["b", "a"]);
    expect(plan.untouchedLocales).toEqual(["de-DE"]);
    expect(plan.skipped.map(({ screen }) => screen.id)).toEqual(["c"]);
  });

  it("rejects every over-full slot at once, before anything reaches the store", () => {
    const phones = Array.from({ length: 9 }, (_, index) => entry("phone", "phone-portrait", "en", `p${index}`));
    const tablets = Array.from({ length: 9 }, (_, index) => entry("tablet-7", "tablet-7-portrait", "de", `t${index}`));
    expect(() => googlePlayUploadPlan([...phones, ...tablets])).toThrow(
      /en-US phoneScreenshots has 9 images; Google Play accepts at most 8\nde-DE sevenInchScreenshots has 9 images/,
    );
    expect(() => googlePlayUploadPlan(phones.slice(0, 8))).not.toThrow();
  });

  it("rejects unmapped and colliding locales", () => {
    expect(() => googlePlayUploadPlan([entry("phone", "phone-portrait", "pt", "a")]))
      .toThrow(/Locale "pt" matches several Google Play locales/);
    expect(() => googlePlayUploadPlan([
      entry("phone", "phone-portrait", "he", "a"),
      entry("phone", "phone-portrait", "iw-IL", "b"),
    ])).toThrow(/Locales "he" and "iw-IL" both map to Google Play locale "iw-IL"/);
  });
});

describe("appStoreUploadPlan", () => {
  it("plans examples/connected-launch: one iPhone set in en-US, every other target skipped with a reason", async () => {
    const raw = await readFile(new URL("../../../examples/connected-launch/app-store-screenshots.json", import.meta.url), "utf8");
    const project = Project.parse(JSON.parse(raw));
    const plan = appStoreUploadPlan(buildBundleEntries(project, project.preferredExportLayoutId, DEFAULT_STORE_SPECS, {}));

    expect(plan.platforms).toEqual(["IOS"]);
    expect(plan.locales).toEqual([{
      platform: "IOS",
      locale: "en-US",
      projectLocale: "en",
      sets: [{
        displayType: "APP_IPHONE_61",
        upload: ["hero", "save-fast", "stay-organized"].map((screenId, index) => expect.objectContaining({
          screenId,
          sizeId: "6.3",
          relativePath: `en-US/APP_IPHONE_61/0${index + 1}.png`,
        })),
        replace: null,
      }],
    }]);
    expect(plan.entries.map(({ relativePath }) => relativePath))
      .toEqual(["en-US/APP_IPHONE_61/01.png", "en-US/APP_IPHONE_61/02.png", "en-US/APP_IPHONE_61/03.png"]);
    expect(plan.skipped.map(({ entry: { screen }, reason }) => [`${screen.platform}/${screen.device}`, reason]))
      .toEqual([["android/phone", "Not an App Store target"], ["web/desktop", "Not an App Store target"]]);
  });

  it("groups by platform, locale and display type in export order, folding landscape twins into one set", () => {
    const plan = appStoreUploadPlan([
      entry("iphone", "6.9", "de", "a", "apple"),
      entry("macos", "2880x1800", "de", "m", "apple"),
      entry("iphone", "6.9-landscape", "de", "b", "apple"),
      entry("iphone", "duo-inner", "de", "d", "apple"),
      entry("watchos", "ultra-3", "de", "w", "apple"),
      entry("tvos", "4k", "de", "t", "apple"),
    ], { images: new Map([["IOS/de-DE/APP_IPHONE_67", [{ id: "old-1" }]]]) });

    expect(plan.platforms).toEqual(["IOS", "MAC_OS", "TV_OS"]);
    expect(plan.locales.map(({ platform, locale, sets }) => [platform, locale, sets.map(({ displayType, upload, replace }) =>
      [displayType, upload.map(({ screenId }) => screenId), replace])])).toEqual([
      ["IOS", "de-DE", [["APP_IPHONE_67", ["a", "b"], [{ id: "old-1" }]], ["APP_WATCH_ULTRA", ["w"], []]]],
      ["MAC_OS", "de-DE", [["APP_DESKTOP", ["m"], []]]],
      ["TV_OS", "de-DE", [["APP_APPLE_TV", ["t"], []]]],
    ]);
    expect(plan.skipped).toEqual([{
      entry: expect.objectContaining({ screen: expect.objectContaining({ id: "d" }) }),
      reason: "The App Store Connect API has no display type for iPhone Duo screenshots",
    }]);
  });

  it("rejects over-full and mixed-size sets at once, before anything reaches the store", () => {
    const phones = Array.from({ length: 11 }, (_, index) => entry("iphone", "6.5", "en", `p${index}`, "apple"));
    expect(() => appStoreUploadPlan([
      ...phones,
      entry("ipad", "13", "ja", "i13", "apple"),
      entry("ipad", "12.9-landscape", "ja", "i129", "apple"),
    ])).toThrow(
      /en-US APP_IPHONE_65 has 11 screenshots; App Store Connect accepts at most 10\nja APP_IPAD_PRO_3GEN_129 mixes 2064x2752 and 2048x2732 screenshots/,
    );
    expect(() => appStoreUploadPlan(phones.slice(0, 10))).not.toThrow();
  });

  it("skips an App Store target that a custom catalog leaves unmapped", () => {
    const unmapped = entry("iphone", "6.9", "en", "a", "apple");
    const { appStoreConnect: _omitted, ...target } = unmapped.target;
    const plan = appStoreUploadPlan([{ ...unmapped, target }]);
    expect(plan.entries).toEqual([]);
    expect(plan.skipped[0]!.reason).toBe("The store catalog gives this target no App Store Connect display type");
  });

  it("rejects locales App Store Connect has no code for", () => {
    expect(() => appStoreUploadPlan([entry("iphone", "6.9", "pt", "a", "apple")]))
      .toThrow(/Locale "pt" matches several App Store Connect locales/);
  });
});
