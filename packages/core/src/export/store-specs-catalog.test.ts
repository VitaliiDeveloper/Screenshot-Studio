// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { SCREEN_DEVICES_BY_PLATFORM } from "@screenshot-studio/core/model";
import {
  DEFAULT_STORE_SPECS,
  OUTPUT_DESTINATIONS,
  OUTPUT_DEVICE_FAMILIES,
  destinationLabel,
  findStoreTarget,
  listOutputDestinations,
  listOutputFamilies,
  outputFamilyLabel,
  parseStoreSpecs,
} from "./specs.js";

const schemaKeys = Object.entries(SCREEN_DEVICES_BY_PLATFORM)
  .flatMap(([platform, devices]) => devices.map((device) => `${platform}/${device}`));

describe("unified store catalog", () => {
  it("derives destinations and every strict-schema family from one decoded model", () => {
    expect(listOutputDestinations(DEFAULT_STORE_SPECS)).toEqual(OUTPUT_DESTINATIONS);
    expect(listOutputFamilies(DEFAULT_STORE_SPECS)).toEqual(OUTPUT_DEVICE_FAMILIES);
    expect(new Set(OUTPUT_DEVICE_FAMILIES.map(({ key }) => key))).toEqual(new Set(schemaKeys));
    expect(new Set(OUTPUT_DESTINATIONS.map(({ id }) => id)))
      .toEqual(new Set(Object.keys(SCREEN_DEVICES_BY_PLATFORM)));
  });

  it("provides destination, family, and composed labels", () => {
    expect(destinationLabel("android")).toBe("Google Play");
    expect(outputFamilyLabel("android", "phone")).toBe("Google Play · Android phone");
    for (const family of OUTPUT_DEVICE_FAMILIES) {
      expect(outputFamilyLabel(family.platform, family.device))
        .toBe(`${destinationLabel(family.platform)} · ${family.label}`);
    }
  });

  it("resolves every family lead from its own nested targets", () => {
    for (const family of OUTPUT_DEVICE_FAMILIES) {
      expect(findStoreTarget(
        DEFAULT_STORE_SPECS,
        family.platform,
        family.device,
        family.leadStoreSizeId,
      ).id).toBe(family.leadStoreSizeId);
    }
  });

  it("labels iPhone targets by their App Store Connect display group, not by inches", () => {
    // Inches collide across groups (6.1" iPhone 16 vs 17e, 6.5" Air vs XR), so the label names
    // the upload slot; the stable ids stay as persisted.
    const labels = Object.fromEntries(["6.9", "6.5", "6.3", "6.1", "6.1-landscape"].map((id) =>
      [id, findStoreTarget(DEFAULT_STORE_SPECS, "apple", "iphone", id)]));
    expect(labels).toMatchObject({
      "6.9": { label: "iPhone Dynamic Island · Large", width: 1320, height: 2868 },
      "6.5": { label: "iPhone Face ID · Large", width: 1284, height: 2778 },
      "6.3": { label: "iPhone Dynamic Island · Medium (lead)", width: 1206, height: 2622 },
      "6.1": { label: "iPhone Face ID · Medium", width: 1125, height: 2436 },
      "6.1-landscape": { label: "iPhone Face ID · Medium landscape", width: 2436, height: 1125 },
    });
  });

  it("leads Android tablets at Play's 9:16 large-screen ratio and keeps the 10:16 migration source", () => {
    const lead = findStoreTarget(DEFAULT_STORE_SPECS, "android", "tablet-7",
      DEFAULT_STORE_SPECS.platforms.android.families["tablet-7"].leadStoreSizeId);
    expect(lead).toMatchObject({ id: "tablet-portrait", width: 1440, height: 2560 });
    expect(findStoreTarget(DEFAULT_STORE_SPECS, "android", "tablet-7", "tablet-landscape"))
      .toMatchObject({ width: 2560, height: 1440, orientation: "landscape" });
    // migrateLeadTarget resolves the previous lead from the current catalog.
    expect(findStoreTarget(DEFAULT_STORE_SPECS, "android", "tablet-7", "tablet-7-portrait"))
      .toMatchObject({ width: 1200, height: 1920 });
  });

  it("offers both iPhone Duo displays as exact iPhone targets without moving the 6.3 lead", () => {
    // App Store Connect's iPhone Duo class is not scaled from other iPhone classes.
    expect(findStoreTarget(DEFAULT_STORE_SPECS, "apple", "iphone", "duo-inner"))
      .toMatchObject({ width: 2007, height: 2853, orientation: "portrait" });
    expect(findStoreTarget(DEFAULT_STORE_SPECS, "apple", "iphone", "duo-inner-landscape"))
      .toMatchObject({ width: 2853, height: 2007, orientation: "landscape" });
    expect(findStoreTarget(DEFAULT_STORE_SPECS, "apple", "iphone", "duo-outer"))
      .toMatchObject({ width: 1398, height: 2034, orientation: "portrait" });
    expect(findStoreTarget(DEFAULT_STORE_SPECS, "apple", "iphone", "duo-outer-landscape"))
      .toMatchObject({ width: 2034, height: 1398, orientation: "landscape" });
    expect(OUTPUT_DEVICE_FAMILIES.find(({ key }) => key === "apple/iphone"))
      .toMatchObject({ leadStoreSizeId: "6.3" });
  });

  it("keeps superseded families visible but non-creatable", () => {
    expect(OUTPUT_DEVICE_FAMILIES.filter(({ creatable }) => !creatable)).toEqual([
      expect.objectContaining({ key: "android/tablet-10", replacementKey: "android/tablet-7" }),
      expect.objectContaining({ key: "web/laptop", replacementKey: "web/desktop" }),
    ]);
  });

  it("rejects promotional targets as family leads", () => {
    const promotionalLead = structuredClone(DEFAULT_STORE_SPECS);
    promotionalLead.platforms.android.families.phone.leadStoreSizeId = "play-feature-graphic";

    expect(() => parseStoreSpecs(promotionalLead))
      .toThrow(/Primary target play-feature-graphic cannot be promotional/);
  });

  it("strictly rejects unknown fields, missing families, and unsafe policy", () => {
    expect(() => parseStoreSpecs({ ...structuredClone(DEFAULT_STORE_SPECS), extra: true }))
      .toThrow(/Unrecognized key/);

    const missing = structuredClone(DEFAULT_STORE_SPECS) as unknown as {
      platforms: { web: { families: Record<string, unknown> } };
    };
    delete missing.platforms.web.families.mobile;
    expect(() => parseStoreSpecs(missing)).toThrow(/Missing output family web\/mobile/);

    const missingReplacement = structuredClone(DEFAULT_STORE_SPECS);
    delete missingReplacement.platforms.web.families.laptop.replacementKey;
    expect(() => parseStoreSpecs(missingReplacement))
      .toThrow(/A non-creatable family must declare its replacement/);

    const invalidRecommended = structuredClone(DEFAULT_STORE_SPECS);
    invalidRecommended.platforms.web.families.mobile.recommended = true;
    expect(() => parseStoreSpecs(invalidRecommended))
      .toThrow(/exactly one creatable recommended family/);
  });
});
