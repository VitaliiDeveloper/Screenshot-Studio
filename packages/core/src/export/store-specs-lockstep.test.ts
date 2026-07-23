// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCREEN_DEVICES_BY_PLATFORM } from "@screenshot-studio/core/model";
import { OUTPUT_DEVICE_FAMILIES } from "@screenshot-studio/core/model";
import { listStoreTargets, parseStoreSpecs, STORE_OUTPUT_TARGETS_KEY } from "./specs.js";

// parseStoreSpecs drops the "$comment" key, so specs holds only real platforms.
const specs = parseStoreSpecs(
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../store-specs.json", import.meta.url)), "utf8"),
  ),
);

const EXPECTED_DEVICE_FAMILIES = {
  apple: ["iphone", "ipad", "macos", "tvos", "watchos", "visionos"],
  android: [
    "phone", "tablet-7", "tablet-10", "chromebook", "tv", "wear", "automotive", "xr",
  ],
  windows: ["desktop", "xbox", "holographic"],
  web: ["desktop", "laptop", "tablet", "mobile"],
} as const;

describe("schema ↔ store-specs lockstep", () => {
  it("declares the same platforms as store-specs", () => {
    expect(new Set(Object.keys(SCREEN_DEVICES_BY_PLATFORM))).toEqual(new Set(Object.keys(specs)));
  });

  it("declares the same devices per platform as store-specs, excluding output catalogs", () => {
    for (const [platform, devices] of Object.entries(SCREEN_DEVICES_BY_PLATFORM)) {
      const specDevices = Object.keys(specs[platform] ?? {})
        .filter((device) => device !== STORE_OUTPUT_TARGETS_KEY);
      expect(new Set(devices)).toEqual(new Set(specDevices));
    }
    for (const platform of Object.keys(specs)) {
      expect(Object.keys(SCREEN_DEVICES_BY_PLATFORM)).toContain(platform);
    }
  });

  it("keeps the complete destination-family set explicit", () => {
    expect(SCREEN_DEVICES_BY_PLATFORM).toEqual(EXPECTED_DEVICE_FAMILIES);
  });

  it("gives every family non-empty, unambiguous targets and one catalog-owned lead", () => {
    for (const [platform, devices] of Object.entries(SCREEN_DEVICES_BY_PLATFORM)) {
      for (const device of devices) {
        const targets = specs[platform]?.[device] ?? [];
        expect(targets.length, `${platform}/${device} has no targets`).toBeGreaterThan(0);
        expect(new Set(targets.map(({ id }) => id)).size, `${platform}/${device} target ids`)
          .toBe(targets.length);
        expect(
          new Set(targets.map(({ width, height, orientation }) =>
            `${width}x${height}/${orientation}`)).size,
          `${platform}/${device} target tuples`,
        ).toBe(targets.length);

        const catalogFamilies = OUTPUT_DEVICE_FAMILIES.filter(({ key }) =>
          key === `${platform}/${device}`);
        expect(catalogFamilies, `${platform}/${device} catalog entry`).toHaveLength(1);
        const leadId = catalogFamilies[0]!.leadStoreSizeId;
        expect(
          listStoreTargets(specs, platform, device).filter(({ id }) => id === leadId),
          `${platform}/${device} lead ${leadId}`,
        ).toHaveLength(1);
      }
    }
  });
});
