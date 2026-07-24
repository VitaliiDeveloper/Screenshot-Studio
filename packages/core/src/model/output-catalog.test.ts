// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findStoreTarget, parseStoreSpecs } from "@screenshot-studio/core/export";
import { SCREEN_DEVICES_BY_PLATFORM } from "./schema.js";
import {
  OUTPUT_DESTINATIONS,
  OUTPUT_DEVICE_FAMILIES,
  destinationLabel,
  outputFamilyLabel,
  parseOutputCatalog,
} from "./output-catalog.js";

const specs = parseStoreSpecs(JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../../store-specs.json", import.meta.url)),
  "utf8",
)));

const schemaKeys = Object.entries(SCREEN_DEVICES_BY_PLATFORM)
  .flatMap(([platform, devices]) => devices.map((device) => `${platform}/${device}`));

function catalogDocument() {
  return {
    schemaVersion: 1,
    destinations: OUTPUT_DESTINATIONS.map((destination) => ({ ...destination })),
    families: OUTPUT_DEVICE_FAMILIES.map((family) => ({ ...family })),
  };
}

describe("output presentation catalog", () => {
  it("covers every strict-schema platform/device pair exactly once", () => {
    const catalogKeys = OUTPUT_DEVICE_FAMILIES.map(({ key }) => key);
    expect(new Set(catalogKeys).size).toBe(catalogKeys.length);
    expect(new Set(catalogKeys)).toEqual(new Set(schemaKeys));

    for (const { key } of OUTPUT_DEVICE_FAMILIES) {
      const [platform, device] = key.split("/");
      expect(platform).toBeDefined();
      expect(device).toBeDefined();
      expect(SCREEN_DEVICES_BY_PLATFORM[platform as keyof typeof SCREEN_DEVICES_BY_PLATFORM])
        .toContain(device);
    }
  });

  it("provides non-empty destination, family, and composed labels", () => {
    expect(new Set(OUTPUT_DESTINATIONS.map(({ id }) => id)))
      .toEqual(new Set(Object.keys(SCREEN_DEVICES_BY_PLATFORM)));
    expect(new Set(OUTPUT_DESTINATIONS.map(({ id }) => id)).size)
      .toBe(OUTPUT_DESTINATIONS.length);

    for (const destination of OUTPUT_DESTINATIONS) {
      expect(destination.label.trim()).not.toBe("");
      expect(destination.shortLabel.trim()).not.toBe("");
      expect(destinationLabel(destination.id)).toBe(destination.label);
    }
    for (const family of OUTPUT_DEVICE_FAMILIES) {
      const [platform, device] = family.key.split("/");
      expect(family.label.trim()).not.toBe("");
      expect(outputFamilyLabel(platform!, device!))
        .toBe(`${destinationLabel(platform!)} · ${family.label}`);
    }

    expect(destinationLabel("android")).toBe("Google Play");
    expect(outputFamilyLabel("android", "phone")).toBe("Google Play · Android phone");
  });

  it("resolves every catalog lead in store-specs.json", () => {
    for (const family of OUTPUT_DEVICE_FAMILIES) {
      const [platform, device] = family.key.split("/");
      expect(findStoreTarget(specs, platform!, device!, family.leadStoreSizeId).id)
        .toBe(family.leadStoreSizeId);
    }
  });

  it("presents every newly supported store output family", () => {
    expect(OUTPUT_DEVICE_FAMILIES).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "apple/visionos", label: "Apple Vision Pro" }),
      expect.objectContaining({ key: "android/chromebook", label: "Chromebook" }),
      expect.objectContaining({ key: "android/tv", label: "Android TV" }),
      expect.objectContaining({ key: "android/wear", label: "Wear OS" }),
      expect.objectContaining({ key: "android/automotive", label: "Android Automotive OS" }),
      expect.objectContaining({ key: "android/xr", label: "Android XR" }),
      expect.objectContaining({ key: "windows/xbox", label: "Xbox" }),
      expect.objectContaining({ key: "windows/holographic", label: "Holographic" }),
    ]));
  });

  it("offers exactly one creatable recommended family per destination", () => {
    for (const { id } of OUTPUT_DESTINATIONS) {
      const recommended = OUTPUT_DEVICE_FAMILIES.filter((family) =>
        family.key.startsWith(`${id}/`) && family.creatable && family.recommended);
      expect(recommended.map(({ key }) => key)).toHaveLength(1);
    }
  });

  it("keeps superseded families visible but non-creatable", () => {
    expect(OUTPUT_DEVICE_FAMILIES.filter(({ creatable }) => !creatable))
      .toEqual([
        expect.objectContaining({
          key: "android/tablet-10", replacementKey: "android/tablet-7",
        }),
        expect.objectContaining({ key: "web/laptop", replacementKey: "web/desktop" }),
      ]);
  });

  it("presents one creatable Android tablet family with 7-inch and 10-inch sizes", () => {
    expect(OUTPUT_DEVICE_FAMILIES.find(({ key }) => key === "android/tablet-7"))
      .toMatchObject({ label: "Android tablet", creatable: true });
    expect(OUTPUT_DEVICE_FAMILIES.find(({ key }) => key === "android/tablet-10"))
      .toMatchObject({ creatable: false, replacementKey: "android/tablet-7" });
    expect(findStoreTarget(specs, "android", "tablet-7", "tablet-10-portrait"))
      .toMatchObject({ width: 1600, height: 2560 });
  });

  it("strictly decodes the JSON document and rejects unknown fields", () => {
    expect(parseOutputCatalog(catalogDocument())).toMatchObject({ schemaVersion: 1 });
    expect(() => parseOutputCatalog({ ...catalogDocument(), extra: true }))
      .toThrow(/Unrecognized key/);
  });

  it("rejects missing and duplicate strict-schema families", () => {
    const missing = catalogDocument();
    missing.families = missing.families.filter(({ key }) => key !== "web/mobile");
    expect(() => parseOutputCatalog(missing)).toThrow(/Missing output family web\/mobile/);

    const duplicate = catalogDocument();
    duplicate.families.push({ ...duplicate.families[0]! });
    expect(() => parseOutputCatalog(duplicate)).toThrow(/Family keys must be unique/);
  });

  it("rejects unsafe creation and replacement policy", () => {
    const missingReplacement = catalogDocument();
    const legacy = missingReplacement.families.find(({ key }) => key === "web/laptop")!;
    delete legacy.replacementKey;
    expect(() => parseOutputCatalog(missingReplacement))
      .toThrow(/A non-creatable family must declare its replacement/);

    const invalidRecommended = catalogDocument();
    const mobile = invalidRecommended.families.find(({ key }) => key === "web/mobile")!;
    mobile.recommended = true;
    expect(() => parseOutputCatalog(invalidRecommended))
      .toThrow(/exactly one creatable recommended family/);
  });
});
