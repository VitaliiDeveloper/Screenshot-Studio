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
import { googlePlayUploadPlan } from "./store-upload-plan.js";

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
