// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import {
  clampZoom,
  filterAddCatalog,
  fitArtboardRowsZoom,
  fitArtboardsZoom,
  groupScreensByOutput,
  OVERVIEW_GAP,
  storeOutputLabel,
  workspaceEditingScope,
  workspaceOverviewRows,
} from "./editor-workspace";

function scopeProject(mode: Project["mode"]): Project {
  const screen = (
    id: string,
    platform: "apple" | "android",
    device: "iphone" | "phone",
  ): Project["screens"][number] => ({
    id,
    name: id,
    platform,
    device,
    locale: "en",
    direction: "ltr",
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#000000" },
    elements: [],
  } as Project["screens"][number]);
  return {
    meta: { name: "Scope", schemaVersion: 10 },
    mode,
    platforms: ["apple", "android"],
    locales: ["en"],
    fonts: [],
    screens: [
      screen("first", "apple", "iphone"),
      screen("unrelated", "android", "phone"),
      screen("second", "apple", "iphone"),
    ],
  };
}

describe("editor workspace helpers", () => {
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
    expect(storeOutputLabel("android", "phone")).toBe("Google Play · Android phone");
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
    expect(filterAddCatalog("frame").map((item) => item.id)).toEqual(["device-frame"]);
    expect(filterAddCatalog("asset").map((item) => item.id)).toEqual([
      "screenshot",
      "image",
      "device-frame",
      "store-badge",
    ]);
    expect(filterAddCatalog("")).toHaveLength(10);
    expect(filterAddCatalog("vector").map((item) => item.id)).toEqual(["icon"]);
    expect(filterAddCatalog("badge").map((item) => item.id)).toEqual([
      "rating-badge",
      "as-seen-on-badge",
      "store-badge",
    ]);
    expect(filterAddCatalog("screenshot").map((item) => item.action)).toEqual([
      "open-asset-picker",
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
        ["App Store · iPhone · 6.5", ["first-65", "second-65"]],
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
      label: "Google Play · Android phone · phone-lead",
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
