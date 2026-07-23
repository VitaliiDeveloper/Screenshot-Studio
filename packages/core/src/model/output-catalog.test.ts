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
} from "./output-catalog.js";

const specs = parseStoreSpecs(JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../../store-specs.json", import.meta.url)),
  "utf8",
)));

const schemaKeys = Object.entries(SCREEN_DEVICES_BY_PLATFORM)
  .flatMap(([platform, devices]) => devices.map((device) => `${platform}/${device}`));

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

  it("offers exactly one creatable recommended family per destination", () => {
    for (const { id } of OUTPUT_DESTINATIONS) {
      const recommended = OUTPUT_DEVICE_FAMILIES.filter((family) =>
        family.key.startsWith(`${id}/`) && family.creatable && family.recommended);
      expect(recommended.map(({ key }) => key)).toHaveLength(1);
    }
  });

  it("keeps only the legacy Web laptop family non-creatable", () => {
    expect(OUTPUT_DEVICE_FAMILIES.filter(({ creatable }) => !creatable))
      .toEqual([expect.objectContaining({ key: "web/laptop", replacementKey: "web/desktop" })]);
  });
});
