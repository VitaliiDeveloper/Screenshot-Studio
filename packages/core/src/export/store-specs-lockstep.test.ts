// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SCREEN_DEVICES_BY_PLATFORM } from "../model/index.js";
import { parseStoreSpecs, STORE_OUTPUT_TARGETS_KEY } from "./specs.js";

// parseStoreSpecs drops the "$comment" key, so specs holds only real platforms.
const specs = parseStoreSpecs(
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../store-specs.json", import.meta.url)), "utf8"),
  ),
);

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
});
