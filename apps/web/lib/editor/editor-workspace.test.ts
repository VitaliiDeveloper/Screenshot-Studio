// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CanvasMode, DesignLayout, Platform } from "@screenshot-studio/core/model";
import {
  DEFAULT_STORE_SPECS,
  listStoreTargets,
  parseStoreSpecs,
  type StoreSize,
} from "@screenshot-studio/core/export";
import {
  clampZoom,
  compactStoreSizeLabel,
  conciseStoreTargetLabel,
  defaultDeviceFrameInputForScreen,
  deviceFrameContextForScreen,
  distinctSizeLabels,
  filterAddCatalog,
  fitArtboardRowsZoom,
  fitArtboardsZoom,
  groupScreensByOutput,
  OVERVIEW_GAP,
  outputFamilyEditorLabel,
  storeOutputLabel,
  workspaceEditingScope,
  workspaceOverviewRows,
} from "./editor-workspace";

function scopeProject(mode: CanvasMode): DesignLayout {
  const screen = (
    id: string,
    platform: "apple" | "android",
    device: "iphone" | "phone",
  ): DesignLayout["screens"][number] => ({
    id,
    name: id,
    platform,
    device,
    locale: "en",
    direction: "ltr",
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#000000" },
    elements: [],
  } as DesignLayout["screens"][number]);
  return {
    id: "primary",
    name: "Primary",
    mode,
    screens: [
      screen("first", "apple", "iphone"),
      screen("unrelated", "android", "phone"),
      screen("second", "apple", "iphone"),
    ],
  };
}

describe("editor workspace helpers", () => {
  it("uses destination and family labels from the runtime catalog", () => {
    const specs = structuredClone(DEFAULT_STORE_SPECS);
    Object.assign(specs.platforms.apple, { label: "Custom Store" });
    Object.assign(specs.platforms.apple.families.iphone, { label: "Custom Phone" });

    expect(storeOutputLabel("apple", "iphone", specs)).toBe("Custom Store · Custom Phone");
    expect(outputFamilyEditorLabel("apple", "iphone", specs)).toBe("Custom Phone");
  });

  it("separates Wear OS insertion from Store recommendation semantics", () => {
    const wearScreen = {
      platform: "android",
      device: "wear",
      artboard: { width: 384, height: 400 },
    } as const;

    expect(deviceFrameContextForScreen(wearScreen)).toMatchObject({
      insertionPresetId: "frameless-watch",
      recommendedPresetId: undefined,
      recommendation: "wearable",
    });
    expect(defaultDeviceFrameInputForScreen(wearScreen)).toEqual({
      deviceType: "frameless-watch",
      width: 300,
      height: 300,
    });
  });

  it("clamps zoom to the supported viewport range", () => {
    expect(clampZoom(0.01)).toBe(0.05);
    expect(clampZoom(1.23456)).toBe(1.235);
    expect(clampZoom(9)).toBe(4);
  });

  it("keeps fixed canvas chrome outside the artboard zoom calculation", () => {
    const screens = Array.from({ length: 3 }, () => ({ width: 660, height: 1434 }));
    expect(fitArtboardsZoom({ width: 1400, height: 900 }, screens, { gap: OVERVIEW_GAP })).toBe(0.477);
    expect(fitArtboardsZoom({ width: 120, height: 900 }, screens, { gap: OVERVIEW_GAP })).toBe(0.05);
  });

  it("fits isolated and gapless connected output rows across both canvas axes", () => {
    const rows = [
      Array.from({ length: 3 }, () => ({ width: 660, height: 1434 })),
      Array.from({ length: 3 }, () => ({ width: 1032, height: 1376 })),
    ];

    expect(fitArtboardRowsZoom(
      { width: 1400, height: 900 },
      rows,
      { columnGap: 48, rowGap: 56, labelHeight: 84 },
    )).toBe(0.184);
    expect(fitArtboardRowsZoom(
      { width: 1400, height: 900 },
      rows,
      { columnGap: 0, rowGap: 56, labelHeight: 84 },
    )).toBe(0.184);
  });

  it("uses human-readable labels for store output families", () => {
    expect(storeOutputLabel("apple", "iphone")).toBe("App Store · iPhone");
    expect(storeOutputLabel("apple", "ipad")).toBe("App Store · iPad");
    expect(storeOutputLabel("apple", "watchos")).toBe("App Store · watchOS");
    expect(storeOutputLabel("android", "phone")).toBe("Google Play · Android phone");
    expect(storeOutputLabel("android", "tablet-7")).toBe("Google Play · Android tablet");
    expect(storeOutputLabel("android", "wear")).toBe("Google Play · Wear OS");
    expect(storeOutputLabel("web", "desktop")).toBe("Web · Desktop");
    expect(storeOutputLabel("web", "laptop")).toBe("Web · Laptop");
    expect(storeOutputLabel("windows", "desktop")).toBe("Microsoft Store · Windows desktop");
    expect(storeOutputLabel("windows", "xbox")).toBe("Microsoft Store · Xbox");
  });

  it.each([
    ["apple", "iphone", "iPhone"],
    ["apple", "ipad", "iPad"],
    ["apple", "macos", "macOS"],
    ["apple", "tvos", "tvOS"],
    ["apple", "watchos", "watchOS"],
    ["apple", "visionos", "Apple Vision Pro"],
    ["android", "phone", "Phone"],
    ["android", "tablet-7", "Tablet"],
    ["android", "tablet-10", "10-inch tablet (legacy)"],
    ["android", "chromebook", "Chromebook"],
    ["android", "tv", "TV"],
    ["android", "wear", "Wear OS"],
    ["android", "automotive", "Automotive OS"],
    ["android", "xr", "XR"],
    ["windows", "desktop", "Desktop"],
    ["windows", "xbox", "Xbox"],
    ["windows", "holographic", "Holographic"],
    ["web", "desktop", "Desktop"],
    ["web", "laptop", "Laptop"],
    ["web", "tablet", "Tablet"],
    ["web", "mobile", "Mobile"],
  ])("uses a concise %s/%s family label", (platform, device, expected) => {
    expect(outputFamilyEditorLabel(platform, device)).toBe(expected);
  });

  it.each([
    ["apple", "iphone", "6.9", '6.9" iPhone (lead)', "portrait", '6.9" · Portrait'],
    ["apple", "iphone", "6.9-landscape", '6.9" iPhone landscape', "landscape", '6.9" · Landscape'],
    ["apple", "iphone", "6.3", "iPhone Dynamic Island · Medium (lead)", "portrait", "Dynamic Island · Medium · Portrait"],
    ["apple", "iphone", "6.1-landscape", "iPhone Face ID · Medium landscape", "landscape", "Face ID · Medium · Landscape"],
    ["apple", "ipad", "13", '13" iPad (lead)', "portrait", '13" · Portrait'],
    ["apple", "macos", "2880x1800", "Mac 2880×1800 (lead)", "landscape", "2880×1800 · Landscape"],
    ["apple", "tvos", "4k", "Apple TV 4K (lead)", "landscape", "4K · Landscape"],
    ["apple", "watchos", "ultra-3", "Apple Watch Ultra 3 (lead)", "portrait", "Ultra 3 · Portrait"],
    ["apple", "visionos", "vision-pro", "Apple Vision Pro (lead)", "landscape", "Landscape"],
    ["android", "phone", "phone-portrait", "Android phone portrait (lead)", "portrait", "Portrait"],
    ["android", "phone", "phone-portrait-high-res", "Android phone portrait high resolution", "portrait", "Portrait · High-res"],
    ["android", "tablet-7", "tablet-portrait", "9:16 Android tablet portrait (lead)", "portrait", "9:16 · Portrait"],
    ["android", "tablet-7", "tablet-7-portrait", "7-inch Android tablet portrait", "portrait", "7-inch · Portrait"],
    ["android", "wear", "wear-square", "Wear OS square (frameless)", "square", "Square · Frameless"],
    ["windows", "desktop", "4k", "Windows desktop 4K (lead)", "landscape", "4K · Landscape"],
    ["web", "tablet", "tablet-portrait", "Web tablet portrait (lead)", "portrait", "Portrait"],
  ])("formats %s/%s/%s targets linearly", (
    platform,
    device,
    id,
    label,
    orientation,
    expected,
  ) => {
    expect(conciseStoreTargetLabel({
      id,
      label,
      width: 100,
      height: 100,
      orientation,
    } as StoreSize, platform, device)).toBe(expected);
  });

  it("keeps promotional asset names separate from screenshot orientation", () => {
    expect(conciseStoreTargetLabel({
      id: "play-feature-graphic",
      label: "Google Play Feature Graphic",
      width: 1024,
      height: 500,
      orientation: "landscape",
      kind: "promotion",
    }, "android", "phone")).toBe("Feature graphic");
  });

  it("formats every persisted store target with orientation in one consistent position", () => {
    const fullSpecs = parseStoreSpecs(JSON.parse(readFileSync(
      fileURLToPath(new URL("../../../../store-specs.json", import.meta.url)),
      "utf8",
    )));

    for (const platform of Object.keys(fullSpecs.platforms) as Platform[]) {
      for (const device of Object.keys(fullSpecs.platforms[platform].families)) {
        for (const target of listStoreTargets(fullSpecs, platform, device)) {
          const label = conciseStoreTargetLabel(target, platform, device);
          const orientation = target.orientation[0]!.toUpperCase() + target.orientation.slice(1);
          const segments = label.split(" · ");
          if (target.kind === "promotion") {
            expect(segments, `${platform}/${device}/${target.id}`).not.toContain(orientation);
            continue;
          }
          expect(
            segments.filter((segment) => segment === orientation),
            `${platform}/${device}/${target.id}: ${label}`,
          ).toHaveLength(1);
          expect(label, `${platform}/${device}/${target.id}`).not.toMatch(/\b(?:lead|portrait|landscape|square)\b.*\b(?:portrait|landscape|square)\b/i);
        }
      }
    }
  });

  it("keeps only the size discriminator when the output already names the device", () => {
    expect(compactStoreSizeLabel('6.9" iPhone (lead)', "iphone")).toBe('6.9"');
    expect(compactStoreSizeLabel('13" iPad (lead)', "ipad")).toBe('13"');
    expect(compactStoreSizeLabel("Mac 2880×1800 (lead)", "macos")).toBe("2880×1800");
    expect(compactStoreSizeLabel("Apple TV 4K (lead)", "tvos")).toBe("4K");
    expect(compactStoreSizeLabel("Apple Watch Ultra 3 (lead)", "watchos")).toBe("Ultra 3");
    expect(compactStoreSizeLabel("Android phone portrait (lead)", "phone")).toBe("portrait");
    expect(compactStoreSizeLabel("Windows desktop Full HD", "desktop")).toBe("Full HD");
  });

  it("keeps the ratio or physical size visible for every canonical Android tablet row", () => {
    expect(compactStoreSizeLabel("9:16 Android tablet portrait (lead)", "tablet-7"))
      .toBe("9:16 portrait");
    expect(compactStoreSizeLabel("16:9 Android tablet landscape", "tablet-7"))
      .toBe("16:9 landscape");
    expect(compactStoreSizeLabel("7-inch Android tablet portrait", "tablet-7"))
      .toBe("7-inch portrait");
    expect(compactStoreSizeLabel("7-inch Android tablet landscape", "tablet-7"))
      .toBe("7-inch landscape");
    expect(compactStoreSizeLabel("10-inch Android tablet portrait", "tablet-7"))
      .toBe("10-inch portrait");
    expect(compactStoreSizeLabel("10-inch Android tablet landscape", "tablet-7"))
      .toBe("10-inch landscape");
  });

  it("groups screens into ordered output-family rows", () => {
    const project = scopeProject("isolated");
    const rows = groupScreensByOutput(project.screens);
    expect(rows.map((row) => row.label)).toEqual([
      "App Store · iPhone",
      "Google Play · Android phone",
    ]);
    expect(rows.map((row) => row.screens.map((screen) => screen.id))).toEqual([
      ["first", "second"],
      ["unrelated"],
    ]);
  });

  it("filters the extensible add catalog by label, group, and hint", () => {
    expect(filterAddCatalog("frame").map((item) => item.id)).toEqual([
      "device-frame",
      "device-frame-image",
    ]);
    expect(filterAddCatalog("asset").map((item) => item.id)).toEqual([
      "screenshot",
      "image",
      "store-badge",
    ]);
    expect(filterAddCatalog("")).toHaveLength(11);
    expect(filterAddCatalog("vector").map((item) => item.id)).toEqual(["icon"]);
    expect(filterAddCatalog("badge").map((item) => item.id)).toEqual([
      "rating-badge",
      "as-seen-on-badge",
      "store-badge",
    ]);
    expect(filterAddCatalog("screenshot").map((item) => item.action)).toEqual([
      "open-asset-picker",
      "insert-device-frame",
      "open-asset-picker",
    ]);
  });

  it("keeps connected editing scope exact and isolated editing scope locale-based", () => {
    const connected = scopeProject("connected");
    expect(workspaceEditingScope(connected, connected.screens[0]!).map((screen) => screen.id))
      .toEqual(["first", "second"]);

    const isolated = scopeProject("isolated");
    expect(workspaceEditingScope(isolated, isolated.screens[0]!).map((screen) => screen.id))
      .toEqual(["first", "unrelated", "second"]);
  });

  it("returns every active-locale output family in stable project order", () => {
    const connected = scopeProject("connected");
    const rows = workspaceOverviewRows(connected, connected.screens[0]!);

    expect(rows.map((row) => [row.key, row.editing, row.screens.map((screen) => screen.id)]))
      .toEqual([
        ["apple/iphone", true, ["first", "second"]],
        ["android/phone", false, ["unrelated"]],
      ]);
  });

  it("substitutes only the active family's exact target group", () => {
    const connected = scopeProject("connected");
    const firstVariant = {
      ...structuredClone(connected.screens[0]!),
      id: "first-65",
      variantOf: "first",
      storeTargetId: "6.5",
    };
    const secondVariant = {
      ...structuredClone(connected.screens[2]!),
      id: "second-65",
      variantOf: "second",
      storeTargetId: "6.5",
    };
    connected.screens.push(firstVariant, secondVariant);

    const rows = workspaceOverviewRows(connected, firstVariant);
    expect(rows.map((row) => [row.label, row.screens.map((screen) => screen.id)]))
      .toEqual([
        ["App Store · iPhone · Face ID · Large · Portrait", ["first-65", "second-65"]],
        ["Google Play · Android phone", ["unrelated"]],
      ]);
  });

  it("falls back to the first exact group for a variant-only family", () => {
    const connected = scopeProject("connected");
    const variantOnly = {
      ...structuredClone(connected.screens[1]!),
      id: "android-target",
      variantOf: "missing-root",
      storeTargetId: "phone-lead",
    };
    connected.screens.splice(1, 1, variantOnly);

    const rows = workspaceOverviewRows(connected, connected.screens[0]!);
    expect(rows[1]).toMatchObject({
      key: "android/phone",
      label: "Google Play · Android phone",
      editing: false,
    });
    expect(rows[1]!.screens.map((screen) => screen.id)).toEqual(["android-target"]);
  });

  it("never mixes row platform, device, locale, or target identity", () => {
    const connected = scopeProject("connected");
    const rows = workspaceOverviewRows(connected, connected.screens[0]!);

    for (const row of rows) {
      const identities = new Set(row.screens.map((screen) =>
        `${screen.platform}/${screen.device}/${screen.locale}/${screen.storeTargetId ?? "root"}`,
      ));
      expect(identities.size).toBe(1);
    }
  });

  it("keeps root artboards and explicit target variants in separate workspace layers", () => {
    const isolated = scopeProject("isolated");
    const variant = {
      ...structuredClone(isolated.screens[0]!),
      id: "first-65",
      variantOf: "first",
      storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
    };
    isolated.screens.push(variant);
    expect(workspaceEditingScope(isolated, isolated.screens[0]!).map((screen) => screen.id))
      .toEqual(["first", "unrelated", "second"]);
    expect(workspaceEditingScope(isolated, variant).map((screen) => screen.id))
      .toEqual(["first-65"]);
  });

  it("shows isolated root and exact-target groups as separate overview rows", () => {
    const isolated = scopeProject("isolated");
    const variant = {
      ...structuredClone(isolated.screens[0]!),
      id: "first-65",
      variantOf: "first",
      storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
    };
    isolated.screens.push(variant);

    const rows = workspaceOverviewRows(isolated, isolated.screens[0]!);
    expect(rows.map((row) => [row.label, row.editing, row.screens.map((screen) => screen.id)]))
      .toEqual([
        ["App Store · iPhone", true, ["first", "second"]],
        ["App Store · iPhone · Face ID · Large · Portrait", false, ["first-65"]],
        ["Google Play · Android phone", false, ["unrelated"]],
      ]);
  });

  it("keeps same-target variants from multiple roots together in connected project order", () => {
    const connected = scopeProject("connected");
    const firstVariant = {
      ...structuredClone(connected.screens[0]!),
      id: "first-65",
      variantOf: "first",
      storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
    };
    const secondVariant = {
      ...structuredClone(connected.screens[2]!),
      id: "second-65",
      variantOf: "second",
      storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
    };
    connected.screens.push(firstVariant, secondVariant);

    expect(workspaceEditingScope(connected, connected.screens[0]!).map((screen) => screen.id))
      .toEqual(["first", "second"]);
    expect(workspaceEditingScope(connected, firstVariant).map((screen) => screen.id))
      .toEqual(["first-65", "second-65"]);
  });
});

describe("distinctSizeLabels", () => {
  it("appends artboard px only to labels the list repeats", () => {
    const artboard = (width: number, height: number) => ({ artboard: { width, height } });
    expect(distinctSizeLabels([
      { label: '6.3"', screen: artboard(603, 1311) },
      { label: '6.3"', screen: artboard(1206, 2622) },
      { label: '6.9"', screen: artboard(1320, 2868) },
    ])).toEqual(['6.3" · 603 × 1311', '6.3" · 1206 × 2622', '6.9"']);
  });
});
