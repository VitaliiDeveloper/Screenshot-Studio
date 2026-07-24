// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCREEN_DEVICES_BY_PLATFORM } from "@screenshot-studio/core/model";
import {
  listOutputFamilies,
  listStoreTargets,
  parseStoreSpecs,
  type StoreFamily,
  type StoreSpecs,
} from "./specs.js";

const rawCatalog = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../../store-specs.json", import.meta.url)),
  "utf8",
));
const specs = parseStoreSpecs(rawCatalog);

const EXPECTED_DEVICE_FAMILIES = {
  apple: ["iphone", "ipad", "macos", "tvos", "watchos", "visionos"],
  android: [
    "phone", "tablet-7", "tablet-10", "chromebook", "tv", "wear", "automotive", "xr",
  ],
  windows: ["desktop", "xbox", "holographic"],
  web: ["desktop", "laptop", "tablet", "mobile"],
} as const;

function assertFamilyTargetIntegrity(
  source: StoreSpecs,
  platform: string,
  device: string,
): void {
  const targets = listStoreTargets(source, platform, device);
  expect(targets.length, `${platform}/${device} has no targets`).toBeGreaterThan(0);
  expect(new Set(targets.map(({ id }) => id)).size, `${platform}/${device} target ids`)
    .toBe(targets.length);
  expect(new Set(targets.map(({ width, height, orientation }) =>
    `${width}x${height}/${orientation}`)).size,
  `${platform}/${device} target tuples`).toBe(targets.length);

  const families = source.platforms[platform as keyof StoreSpecs["platforms"]]!.families as
    Record<string, StoreFamily>;
  const family = families[device]!;
  expect(targets.filter(({ id }) => id === family.leadStoreSizeId),
    `${platform}/${device} lead ${family.leadStoreSizeId}`).toHaveLength(1);
}

describe("schema ↔ store catalog lockstep", () => {
  it("declares exactly the strict-schema platforms and families", () => {
    expect(new Set(Object.keys(specs.platforms)))
      .toEqual(new Set(Object.keys(SCREEN_DEVICES_BY_PLATFORM)));
    for (const [platform, devices] of Object.entries(SCREEN_DEVICES_BY_PLATFORM)) {
      expect(new Set(Object.keys(specs.platforms[platform as keyof StoreSpecs["platforms"]]!.families)))
        .toEqual(new Set(devices));
    }
    expect(SCREEN_DEVICES_BY_PLATFORM).toEqual(EXPECTED_DEVICE_FAMILIES);
  });

  it("gives every family non-empty, unambiguous targets and one catalog-owned lead", () => {
    for (const family of listOutputFamilies(specs)) {
      assertFamilyTargetIntegrity(specs, family.platform, family.device);
    }
  });

  it("nests non-device outputs under their owning family", () => {
    expect(listStoreTargets(specs, "android", "phone")).toContainEqual(expect.objectContaining({
      id: "play-feature-graphic",
      kind: "promotion",
      width: 1024,
      height: 500,
    }));
    expect(Object.keys(specs.platforms.android.families)).not.toContain("$outputs");
  });

  it("rejects duplicate target ids and dimension tuples inside a family", () => {
    const duplicateId = structuredClone(rawCatalog);
    duplicateId.platforms.android.families.phone.targets.push({
      ...duplicateId.platforms.android.families.phone.targets[0],
      width: 1000,
      height: 2000,
    });
    expect(() => parseStoreSpecs(duplicateId)).toThrow(/Target ids must be unique/);

    const duplicateTuple = structuredClone(rawCatalog);
    duplicateTuple.platforms.android.families.phone.targets.push({
      ...duplicateTuple.platforms.android.families.phone.targets[0],
      id: "another-phone-portrait",
    });
    expect(() => parseStoreSpecs(duplicateTuple)).toThrow(/Target dimensions must be unique/);
  });
});
