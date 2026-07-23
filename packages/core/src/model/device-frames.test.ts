// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  DEVICE_FRAME_PRESETS,
  DEVICE_FRAME_SPECS,
  deviceFramePreset,
  listDeviceFramePresets,
  type DeviceFrameSpec,
} from "./device-frames.js";
import { DEVICE_FRAME_IDS, type DeviceFrameId } from "./schema.js";

const LEGACY_SPECS = {
  iphone: {
    aspectRatio: 6 / 13,
    bezelColor: "#1A1A1C",
    frameCornerRadius: 0.14,
    slotInset: { top: 0.028, right: 0.035, bottom: 0.028, left: 0.035 },
    slotCornerRadius: 0.1,
    notch: { widthFrac: 0.32, heightFrac: 0.018, topFrac: 0.022 },
  },
  "android-phone": {
    aspectRatio: 0.48,
    bezelColor: "#202124",
    frameCornerRadius: 0.11,
    slotInset: { top: 0.024, right: 0.028, bottom: 0.024, left: 0.028 },
    slotCornerRadius: 0.075,
    notch: { widthFrac: 0.035, heightFrac: 0.016, topFrac: 0.012 },
  },
  tablet: {
    aspectRatio: 0.75,
    bezelColor: "#242426",
    frameCornerRadius: 0.055,
    slotInset: { top: 0.035, right: 0.035, bottom: 0.035, left: 0.035 },
    slotCornerRadius: 0.025,
  },
  desktop: {
    aspectRatio: 1.6,
    bezelColor: "#25262A",
    frameCornerRadius: 0.025,
    slotInset: { top: 0.035, right: 0.025, bottom: 0.08, left: 0.025 },
    slotCornerRadius: 0.012,
  },
  laptop: {
    aspectRatio: 16 / 10,
    bezelColor: "#202124",
    frameCornerRadius: 0.022,
    slotInset: { top: 0.035, right: 0.03, bottom: 0.075, left: 0.03 },
    slotCornerRadius: 0.01,
  },
  browser: {
    aspectRatio: 16 / 10,
    bezelColor: "#D1D5DB",
    frameCornerRadius: 0.025,
    slotInset: { top: 0.08, right: 0.012, bottom: 0.018, left: 0.012 },
    slotCornerRadius: 0.008,
  },
  tv: {
    aspectRatio: 16 / 9,
    bezelColor: "#17181B",
    frameCornerRadius: 0.018,
    slotInset: { top: 0.025, right: 0.025, bottom: 0.055, left: 0.025 },
    slotCornerRadius: 0.008,
  },
  watch: {
    aspectRatio: 0.82,
    bezelColor: "#1E1E20",
    frameCornerRadius: 0.23,
    slotInset: { top: 0.045, right: 0.055, bottom: 0.045, left: 0.055 },
    slotCornerRadius: 0.18,
  },
} satisfies Record<string, DeviceFrameSpec>;

const SEMANTIC_IDS = [
  "phone-modern-dark",
  "phone-modern-light",
  "phone-punch-hole-dark",
  "phone-outline",
  "frameless-phone",
  "tablet-rounded-light",
  "browser-dark",
  "laptop-silver",
  "display-stand",
  "watch-square",
  "foldable",
  "automotive-display",
  "xr-viewport",
] as const;

describe("device frame preset catalog", () => {
  it("preserves every legacy renderer spec exactly", () => {
    for (const [id, spec] of Object.entries(LEGACY_SPECS)) {
      expect(DEVICE_FRAME_SPECS[id as keyof typeof LEGACY_SPECS]).toEqual(spec);
      expect(deviceFramePreset(id as keyof typeof LEGACY_SPECS)).toMatchObject({ id, legacy: true });
    }
  });

  it("contains unique stable IDs and every initial semantic preset", () => {
    const ids = DEVICE_FRAME_PRESETS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(DEVICE_FRAME_IDS);
    expect(ids).toEqual(expect.arrayContaining([...SEMANTIC_IDS]));
  });

  it("provides human metadata and normalized previewable recipes", () => {
    const normalized = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

    for (const preset of DEVICE_FRAME_PRESETS) {
      expect(preset.label).toMatch(/\S+\s*\S*/);
      expect(preset.group).toMatch(/\S/);
      expect(preset.tags.length).toBeGreaterThan(0);
      expect(preset.finish).toMatch(/\S/);
      expect(preset.recommendedFor.length).toBeGreaterThan(0);
      expect(preset.recipe.spec.aspectRatio).toBeGreaterThan(0);
      expect(preset.recipe.spec.bezelColor).toMatch(/^#[\dA-F]{6}(?:[\dA-F]{2})?$/i);
      expect(normalized(preset.recipe.spec.frameCornerRadius)).toBe(true);
      expect(normalized(preset.recipe.spec.slotCornerRadius)).toBe(true);
      expect(Object.values(preset.recipe.spec.slotInset).every(normalized)).toBe(true);
      expect(preset.recipe.spec.slotInset.left + preset.recipe.spec.slotInset.right).toBeLessThan(1);
      expect(preset.recipe.spec.slotInset.top + preset.recipe.spec.slotInset.bottom).toBeLessThan(1);
      if (preset.recipe.spec.notch) {
        expect(Object.values(preset.recipe.spec.notch).every(normalized)).toBe(true);
      }
      for (const [decoration, recipe] of Object.entries(preset.recipe)) {
        if (decoration === "spec") continue;
        for (const [field, value] of Object.entries(recipe)) {
          if (field.endsWith("Frac") || field === "opacity") {
            expect(normalized(value as number), `${preset.id}.${decoration}.${field}`).toBe(true);
          }
        }
      }
      expect(deviceFramePreset(preset.id).recipe.spec).toBe(preset.recipe.spec);
    }
  });

  it("filters with AND semantics without exposing mutable catalog storage", () => {
    expect(listDeviceFramePresets({ group: "phone", finish: "dark", legacy: false })
      .map(({ id }) => id)).toEqual(["phone-modern-dark", "phone-punch-hole-dark"]);
    expect(listDeviceFramePresets({ tags: ["minimal", "frameless"] })
      .map(({ id }) => id)).toEqual(["frameless-phone"]);
    expect(listDeviceFramePresets({ recommendedFor: ["mobile"] }).length).toBeGreaterThan(0);

    const result = listDeviceFramePresets();
    result.pop();
    expect(listDeviceFramePresets()).toHaveLength(DEVICE_FRAME_PRESETS.length);
  });

  it("returns stable lookups and rejects unknown IDs predictably", () => {
    expect(deviceFramePreset("phone-modern-dark")).toBe(deviceFramePreset("phone-modern-dark"));
    expect(() => deviceFramePreset("not-a-preset" as DeviceFrameId)).toThrowError(
      new RangeError('Unknown device frame preset: "not-a-preset"'),
    );
  });
});
