// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import {
  clampZoom,
  filterAddCatalog,
  fitArtboardsZoom,
  fitZoom,
  OVERVIEW_GAP,
  workspaceScreenScope,
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
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(1.23456)).toBe(1.235);
    expect(clampZoom(9)).toBe(4);
  });

  it("fits content inside the viewport with stable padding", () => {
    expect(fitZoom({ width: 1400, height: 900 }, { width: 660, height: 1434 })).toBe(0.471);
    expect(fitZoom({ width: 0, height: 900 }, { width: 660, height: 1434 })).toBe(1);
  });

  it("keeps fixed canvas chrome outside the artboard zoom calculation", () => {
    const screens = Array.from({ length: 3 }, () => ({ width: 660, height: 1434 }));
    expect(fitArtboardsZoom({ width: 1400, height: 900 }, screens, { gap: OVERVIEW_GAP })).toBe(0.499);
    expect(fitArtboardsZoom({ width: 120, height: 900 }, screens, { gap: OVERVIEW_GAP })).toBe(0.25);
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

  it("scopes connected workspaces to the exact group and isolated workspaces to the locale", () => {
    const connected = scopeProject("connected");
    expect(workspaceScreenScope(connected, connected.screens[0]!).map((screen) => screen.id))
      .toEqual(["first", "second"]);
    const isolated = scopeProject("isolated");
    expect(workspaceScreenScope(isolated, isolated.screens[0]!).map((screen) => screen.id))
      .toEqual(["first", "unrelated", "second"]);
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
    expect(workspaceScreenScope(isolated, isolated.screens[0]!).map((screen) => screen.id))
      .toEqual(["first", "unrelated", "second"]);
    expect(workspaceScreenScope(isolated, variant).map((screen) => screen.id))
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

    expect(workspaceScreenScope(connected, connected.screens[0]!).map((screen) => screen.id))
      .toEqual(["first", "second"]);
    expect(workspaceScreenScope(connected, firstVariant).map((screen) => screen.id))
      .toEqual(["first-65", "second-65"]);
  });
});
