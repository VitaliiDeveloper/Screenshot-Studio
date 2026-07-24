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
