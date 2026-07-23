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

const INITIAL_BUNDLED_FRAME_SET = {
  Phone: [
    "phone-modern-dark", "phone-modern-light", "phone-punch-hole-dark", "phone-outline",
    "frameless-phone",
  ],
  Tablet: ["tablet-rounded-dark", "tablet-rounded-light", "tablet-outline", "frameless-tablet"],
  Browser: ["browser-light", "browser-dark", "browser-minimal", "frameless-browser"],
  Computer: ["laptop-silver", "laptop-dark", "display-stand", "display-minimal"],
  TV: ["tv-flat", "display-minimal"],
  Watch: ["watch-rounded", "watch-square", "frameless-watch"],
  Special: ["foldable", "automotive-display", "xr-viewport"],
} as const satisfies Record<string, readonly DeviceFrameId[]>;

const SEMANTIC_IDS = [...new Set(Object.values(INITIAL_BUNDLED_FRAME_SET).flat())];

describe("device frame preset catalog", () => {
  it("preserves every legacy renderer spec exactly", () => {
    for (const [id, spec] of Object.entries(LEGACY_SPECS)) {
      expect(DEVICE_FRAME_SPECS[id as keyof typeof LEGACY_SPECS]).toEqual(spec);
      expect(deviceFramePreset(id as keyof typeof LEGACY_SPECS)).toMatchObject({ id, legacy: true });
    }
  });

  it("contains exactly the complete initial bundled frame set", () => {
    const ids = DEVICE_FRAME_PRESETS.map(({ id }) => id);
    const semanticIds = DEVICE_FRAME_PRESETS.filter(({ legacy }) => !legacy).map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(DEVICE_FRAME_IDS);
    expect(SEMANTIC_IDS).toHaveLength(24);
    expect(semanticIds).toHaveLength(24);
    expect(new Set(semanticIds)).toEqual(new Set(SEMANTIC_IDS));
    expect(DEVICE_FRAME_PRESETS.filter(({ legacy }) => legacy).map(({ id }) => id))
      .toEqual(Object.keys(LEGACY_SPECS));
  });

  it("reuses one minimal display across desktop and television contexts", () => {
    expect(INITIAL_BUNDLED_FRAME_SET.Computer).toContain("display-minimal");
    expect(INITIAL_BUNDLED_FRAME_SET.TV).toContain("display-minimal");
    expect(deviceFramePreset("display-minimal").recommendedFor)
      .toEqual(expect.arrayContaining(["desktop", "television"]));
    expect(DEVICE_FRAME_PRESETS.filter(({ id }) => id === "display-minimal")).toHaveLength(1);
  });

  it("keeps the Wear insertion frame square, bezel-free, and shadow-free", () => {
    const preset = deviceFramePreset("frameless-watch");
    expect(preset).toMatchObject({
      group: "wearable",
      finish: "frameless",
      legacy: false,
      recipe: {
        spec: {
          aspectRatio: 1,
          bezelColor: "#00000000",
          slotInset: { top: 0, right: 0, bottom: 0, left: 0 },
        },
      },
    });
    expect(preset.recipe.shadow).toBeUndefined();
    expect(preset.recipe.outline).toBeUndefined();
  });

  it("provides human metadata and normalized previewable recipes", () => {
    const normalized = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
    const color = /^#[\dA-F]{6}(?:[\dA-F]{2})?$/i;
    const assertNormalizedRecipeFields = (value: unknown, path: string): void => {
      if (value === null || typeof value !== "object") return;
      for (const [field, child] of Object.entries(value)) {
        const childPath = `${path}.${field}`;
        if (field.toLowerCase().includes("color")) {
          expect(child, childPath).toMatch(color);
        }
        if (field.endsWith("Frac") || field === "opacity") {
          expect(normalized(child as number), childPath).toBe(true);
        }
        assertNormalizedRecipeFields(child, childPath);
      }
    };

    for (const preset of DEVICE_FRAME_PRESETS) {
      expect(preset.label).toMatch(/\S+\s*\S*/);
      expect(preset.group).toMatch(/\S/);
      expect(preset.tags.length).toBeGreaterThan(0);
      expect(preset.finish).toMatch(/\S/);
      expect(preset.recommendedFor.length).toBeGreaterThan(0);
      expect(preset.recipe.spec.aspectRatio).toBeGreaterThan(0);
      expect(preset.recipe.spec.bezelColor).toMatch(color);
      expect(normalized(preset.recipe.spec.frameCornerRadius)).toBe(true);
      expect(normalized(preset.recipe.spec.slotCornerRadius)).toBe(true);
      expect(Object.values(preset.recipe.spec.slotInset).every(normalized)).toBe(true);
      expect(preset.recipe.spec.slotInset.left + preset.recipe.spec.slotInset.right).toBeLessThan(1);
      expect(preset.recipe.spec.slotInset.top + preset.recipe.spec.slotInset.bottom).toBeLessThan(1);
      if (preset.recipe.spec.notch) {
        expect(Object.values(preset.recipe.spec.notch).every(normalized)).toBe(true);
      }
      assertNormalizedRecipeFields(preset.recipe, preset.id);
      expect(deviceFramePreset(preset.id).recipe.spec).toBe(preset.recipe.spec);
    }
  });

  it("keeps camera, base, outline, and browser decorations inside their box-local bounds", () => {
    for (const preset of DEVICE_FRAME_PRESETS) {
      const { recipe } = preset;
      if (recipe.camera) {
        expect(recipe.camera.widthFrac).toBeGreaterThan(0);
        expect(recipe.camera.heightFrac).toBeGreaterThan(0);
        expect(recipe.camera.xFrac - recipe.camera.widthFrac / 2).toBeGreaterThanOrEqual(0);
        expect(recipe.camera.xFrac + recipe.camera.widthFrac / 2).toBeLessThanOrEqual(1);
        expect(recipe.camera.yFrac - recipe.camera.heightFrac / 2).toBeGreaterThanOrEqual(0);
        expect(recipe.camera.yFrac + recipe.camera.heightFrac / 2).toBeLessThanOrEqual(1);
        if (recipe.camera.kind === "circle") {
          expect(recipe.camera.widthFrac * recipe.spec.aspectRatio)
            .toBeCloseTo(recipe.camera.heightFrac, 10);
        }
      }
      if (recipe.base) {
        expect(recipe.base.widthFrac).toBeGreaterThan(0);
        expect(recipe.base.heightFrac).toBeGreaterThan(0);
        expect(recipe.base.bottomFrac + recipe.base.heightFrac).toBeLessThanOrEqual(1);
        expect(2 * recipe.base.cornerRadiusFrac * recipe.spec.aspectRatio)
          .toBeLessThanOrEqual(recipe.base.heightFrac);
      }
      if (recipe.outline) {
        expect(recipe.outline.widthFrac).toBeGreaterThan(0);
        expect(2 * recipe.outline.insetFrac + recipe.outline.widthFrac).toBeLessThanOrEqual(1);
        expect(2 * (recipe.outline.insetFrac + recipe.outline.widthFrac)
          * recipe.spec.aspectRatio).toBeLessThanOrEqual(1);
      }
      if (recipe.browserChrome) {
        const { addressBar, controls, heightFrac } = recipe.browserChrome;
        const lastControlCenter = controls.firstCenterXFrac
          + (controls.count - 1) * (2 * controls.radiusFrac + controls.gapFrac);
        expect(controls.count).toBeGreaterThan(0);
        expect(Number.isInteger(controls.count)).toBe(true);
        expect(controls.firstCenterXFrac - controls.radiusFrac).toBeGreaterThanOrEqual(0);
        expect(lastControlCenter + controls.radiusFrac).toBeLessThan(addressBar.leftFrac);
        const controlRadiusYFrac = controls.radiusFrac * recipe.spec.aspectRatio;
        expect(controls.centerYFrac - controlRadiusYFrac).toBeGreaterThanOrEqual(0);
        expect(controls.centerYFrac + controlRadiusYFrac).toBeLessThanOrEqual(heightFrac);
        expect(addressBar.leftFrac + addressBar.rightFrac).toBeLessThan(1);
        expect(addressBar.topFrac + addressBar.heightFrac).toBeLessThanOrEqual(heightFrac);
        expect(2 * addressBar.radiusFrac * recipe.spec.aspectRatio)
          .toBeLessThanOrEqual(addressBar.heightFrac);
        expect(heightFrac).toBeLessThanOrEqual(recipe.spec.slotInset.top);
      }
    }
  });

  it("keeps the spatial viewport truly frameless with no declared outline", () => {
    const xr = deviceFramePreset("xr-viewport");
    expect(xr.finish).toBe("frameless");
    expect(xr.recipe.spec.slotInset).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(xr.recipe.outline).toBeUndefined();
  });

  it("filters with AND semantics without exposing mutable catalog storage", () => {
    expect(listDeviceFramePresets({ group: "phone", finish: "dark", legacy: false })
      .map(({ id }) => id)).toEqual(["phone-modern-dark", "phone-punch-hole-dark"]);
    expect(listDeviceFramePresets({ tags: ["minimal", "frameless"] })
      .map(({ id }) => id)).toEqual([
        "frameless-phone", "frameless-tablet", "frameless-browser", "frameless-watch",
      ]);
    expect(listDeviceFramePresets({ recommendedFor: ["mobile"] }).length).toBeGreaterThan(0);

    expect(listDeviceFramePresets()).toHaveLength(DEVICE_FRAME_PRESETS.length);
  });

  it("deeply freezes every public catalog view and shared geometry reference", () => {
    const checked = new WeakSet<object>();
    const expectDeeplyFrozen = (value: unknown): void => {
      if (value === null || typeof value !== "object" || checked.has(value)) return;
      checked.add(value);
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value)) expectDeeplyFrozen(child);
    };
    const preset = deviceFramePreset("phone-modern-dark");
    const originalLeft = preset.recipe.spec.slotInset.left;
    const originalTag = preset.tags[0];
    const originalBezel = DEVICE_FRAME_SPECS["phone-modern-dark"].bezelColor;

    expectDeeplyFrozen(DEVICE_FRAME_PRESETS);
    expectDeeplyFrozen(DEVICE_FRAME_SPECS);
    expectDeeplyFrozen(listDeviceFramePresets({ legacy: false }));

    expect(() => {
      (preset.recipe.spec.slotInset as { left: number }).left = 0.4;
    }).toThrow(TypeError);
    expect(() => {
      (preset.tags as string[])[0] = "hostile";
    }).toThrow(TypeError);
    expect(() => {
      (listDeviceFramePresets() as unknown[]).pop();
    }).toThrow(TypeError);
    expect(() => {
      (DEVICE_FRAME_SPECS as Record<string, { bezelColor: string }>)["phone-modern-dark"]!
        .bezelColor = "#FF00FF";
    }).toThrow(TypeError);

    expect(deviceFramePreset("phone-modern-dark").recipe.spec.slotInset.left).toBe(originalLeft);
    expect(deviceFramePreset("phone-modern-dark").tags[0]).toBe(originalTag);
    expect(DEVICE_FRAME_SPECS["phone-modern-dark"].bezelColor).toBe(originalBezel);

    if (process.env.TYPECHECK_READONLY_CATALOG === "1") {
      // @ts-expect-error public recipes are deeply readonly
      preset.recipe.spec.slotInset.left = 0.4;
      // @ts-expect-error public metadata arrays are readonly
      preset.tags.push("hostile");
      // @ts-expect-error public catalog arrays are readonly
      DEVICE_FRAME_PRESETS.pop();
      // @ts-expect-error filtered public arrays are readonly
      listDeviceFramePresets().pop();
      // @ts-expect-error public lookup tables are readonly
      DEVICE_FRAME_SPECS["phone-modern-dark"] = preset.recipe.spec;
    }
  });

  it("returns stable lookups and rejects unknown IDs predictably", () => {
    expect(deviceFramePreset("phone-modern-dark")).toBe(deviceFramePreset("phone-modern-dark"));
    expect(() => deviceFramePreset("not-a-preset" as DeviceFrameId)).toThrowError(
      new RangeError('Unknown device frame preset: "not-a-preset"'),
    );
  });
});
