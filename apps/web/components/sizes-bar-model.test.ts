// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { DesignLayout, Screen } from "@screenshot-studio/core/model";
import { DEFAULT_STORE_SPECS } from "@screenshot-studio/core/export";
import { adjacentSizeScreenId } from "@web/lib/editor/editor-workspace";
import { NEW_DESTINATION_GROUP, sizeChipTooltip, sizesBarModel } from "./sizes-bar-model.js";

const specs = DEFAULT_STORE_SPECS;
const desktop = {
  id: "web-desktop",
  name: "Hero",
  platform: "web",
  device: "desktop",
  locale: "en",
  direction: "ltr",
  artboard: { width: 1920, height: 1080 },
  background: { type: "solid", color: "#ffffff" },
  elements: [],
} as Screen;
const desktopVariant = {
  ...desktop,
  id: "web-desktop-1440",
  variantOf: desktop.id,
  storeTargetId: "desktop-1440",
  artboard: { width: 1440, height: 900 },
} as Screen;
const mobile = { ...desktop, id: "web-mobile", device: "mobile", artboard: { width: 390, height: 844 } } as Screen;
const androidPhone = {
  ...desktop,
  id: "android-phone",
  platform: "android",
  device: "phone",
  artboard: { width: 1080, height: 1920 },
} as Screen;

function layoutOf(...screens: Screen[]): DesignLayout {
  return { id: "primary", name: "Primary", mode: "isolated", screens } as DesignLayout;
}

function chips(layout: DesignLayout, active: Screen) {
  return sizesBarModel(layout, active, specs).groups.flatMap((group) => group.chips);
}

describe("sizesBarModel", () => {
  it("lists the master first, then variants, with their roles and the current size", () => {
    const model = sizesBarModel(layoutOf(desktop, desktopVariant), desktopVariant, specs);

    expect(model.groups.map(({ label }) => label)).toEqual(["Web · Desktop"]);
    expect(model.groups[0]!.chips.map(({ label, role, current }) => ({ label, role, current }))).toEqual([
      { label: "1920×1080 · Landscape", role: "master", current: false },
      { label: "1440×900 · Landscape", role: "variant", current: true },
    ]);
    expect(model.current?.removal).toEqual({
      kind: "size",
      rootScreenId: desktop.id,
      targetId: "desktop-1440",
      label: "1440×900 · Landscape",
      synchronized: false,
    });
  });

  it("shows pixels only when the label does not already name them", () => {
    const [master] = chips(layoutOf(desktop), desktop);
    const [phone] = chips(layoutOf(androidPhone), androidPhone);

    expect(master!.pixels).toBeNull();
    expect(phone!.pixels).toBe("1080×1920");
  });

  it("removes a master only as a whole family, and never the last one", () => {
    const one = chips(layoutOf(desktop), desktop);
    const two = chips(layoutOf(desktop, mobile), desktop);

    expect(one[0]!.removal).toBeNull();
    expect(two.map(({ removal }) => removal)).toEqual([
      { kind: "family", sourceScreenId: desktop.id, label: "Web · Desktop" },
      { kind: "family", sourceScreenId: mobile.id, label: "Web · Mobile" },
    ]);
  });

  it("orders chips the way [ and ] step through sizes", () => {
    const layout = layoutOf(desktop, desktopVariant, mobile);
    const stepped = [desktop.id];
    let active = desktop;
    for (;;) {
      const next = adjacentSizeScreenId(layout, active, 1, specs);
      if (!next) break;
      stepped.push(next);
      active = layout.screens.find(({ id }) => id === next)!;
    }

    expect(chips(layout, desktop).map(({ screenId }) => screenId)).toEqual(stepped);
  });

  it("opens the active slot's screen and keeps family sizes when a sibling master is selected", () => {
    const sibling = { ...desktop, id: "web-desktop-secondary", name: "Secondary" } as Screen;
    const siblingVariant = { ...desktopVariant, id: "web-desktop-secondary-1440", variantOf: sibling.id } as Screen;
    const variantChip = (layout: DesignLayout, active: Screen) =>
      chips(layout, active).find(({ role }) => role === "variant")!;

    expect(variantChip(layoutOf(desktop, sibling, desktopVariant), sibling)).toMatchObject({
      screenId: desktopVariant.id,
      removal: { rootScreenId: desktop.id },
    });
    expect(variantChip(layoutOf(desktop, sibling, desktopVariant, siblingVariant), sibling).screenId)
      .toBe(siblingVariant.id);
  });

  it("does not leak sizes from another locale", () => {
    const frenchRoot = { ...desktop, id: "web-desktop-fr", locale: "fr" } as Screen;
    const frenchVariant = { ...desktopVariant, id: "web-desktop-1440-fr", locale: "fr", variantOf: frenchRoot.id } as Screen;

    expect(chips(layoutOf(desktop, frenchRoot, frenchVariant), desktop).map(({ role }) => role)).toEqual(["master"]);
  });

  it("offers each family's missing sizes under its destination and new destinations last", () => {
    const { addOptions } = sizesBarModel(layoutOf(desktop, mobile), desktop, specs);
    const groups = [...new Set(addOptions.map(({ group }) => group))];
    const desktopSizes = addOptions.filter(({ group }) => group === "Web · Desktop");
    const mobileSizes = addOptions.filter(({ group }) => group === "Web · Mobile");
    const destinations = addOptions.filter(({ group }) => group === NEW_DESTINATION_GROUP).map(({ label }) => label);
    const offersDesktop1440 = (options: typeof addOptions) =>
      options.some(({ action }) => action.kind === "size" && action.target.id === "desktop-1440");

    expect(groups[0]).toBe("Web · Desktop");
    expect(groups.at(-1)).toBe(NEW_DESTINATION_GROUP);
    expect(offersDesktop1440(desktopSizes)).toBe(true);
    expect(offersDesktop1440(sizesBarModel(layoutOf(desktop, desktopVariant), desktop, specs).addOptions)).toBe(false);
    expect(desktopSizes.every(({ action }) => action.kind === "size" && action.openScreenId === null)).toBe(true);
    expect(mobileSizes.every(({ action }) => action.kind === "size" && action.openScreenId === mobile.id)).toBe(true);
    expect(destinations).toContain("App Store · iPhone");
    expect(destinations).not.toContain("Web · Desktop");
    expect(destinations).not.toContain("Web · Mobile");
    expect(destinations.some((label) => /laptop/i.test(label))).toBe(false);
  });

  it("keeps a legacy family visible and openable without offering it as new", () => {
    const legacyTablet = { ...androidPhone, id: "android-tablet-10", device: "tablet-10", artboard: { width: 1600, height: 2560 } } as Screen;
    const model = sizesBarModel(layoutOf(androidPhone, legacyTablet), androidPhone, specs);
    const legacyGroup = model.groups.find(({ key }) => key === "android/tablet-10")!;

    expect(legacyGroup.label).toBe("Google Play · 10-inch tablet (legacy)");
    expect(legacyGroup.chips[0]!.screenId).toBe(legacyTablet.id);
    expect(model.addOptions.some(({ label }) => label.includes("(legacy)"))).toBe(false);
  });

  it("names promotion and phone sizes concisely and keeps Apple casing", () => {
    const featureGraphic = {
      ...androidPhone,
      id: "android-phone-feature-graphic",
      variantOf: androidPhone.id,
      storeTargetId: "play-feature-graphic",
      artboard: { width: 1024, height: 500 },
    } as Screen;
    const landscape = { ...featureGraphic, id: "android-phone-landscape", storeTargetId: "phone-landscape" } as Screen;
    const highRes = { ...featureGraphic, id: "android-phone-high-res", storeTargetId: "phone-portrait-high-res" } as Screen;
    const iphone = { ...desktop, id: "iphone", platform: "apple", device: "iphone" } as Screen;
    const mac = { ...desktop, id: "mac", platform: "apple", device: "macos" } as Screen;

    expect(chips(layoutOf(androidPhone, featureGraphic, landscape, highRes), androidPhone).map(({ label, pixels }) => [label, pixels]))
      .toEqual([
        ["Portrait", "1080×1920"],
        ["Feature graphic", "1024×500"],
        ["Landscape", "1920×1080"],
        ["Portrait · High-res", "1440×2560"],
      ]);
    const apple = sizesBarModel(layoutOf(iphone, mac), iphone, specs);
    expect(apple.groups.map(({ label }) => label)).toEqual(["App Store · iPhone", "App Store · macOS"]);
    expect(apple.groups[0]!.chips[0]).toMatchObject({ label: "Dynamic Island · Medium", pixels: "1206×2622" });
    expect(apple.groups[0]!.chips[0]!.tooltip).toBe([
      "iPhone with Dynamic Island (medium display)",
      "iPhone 14 Pro – 18 Pro · 8 models",
      "iPhone 18 Pro, iPhone 17 Pro, iPhone 17, iPhone 16 Pro, iPhone 16, iPhone 15 Pro, iPhone 15, iPhone 14 Pro",
      "1206×2622",
    ].join("\n"));
    expect(apple.groups[1]!.chips[0]!.tooltip).toBe("2880×1800");
  });

  it("names the App Store Connect group of every iPhone target that lists devices", () => {
    const listed = DEFAULT_STORE_SPECS.platforms.apple!.families.iphone!.targets.filter(({ devices }) => devices);
    expect(listed.length).toBeGreaterThan(0);
    for (const target of listed) expect(sizeChipTooltip(target), target.id).toMatch(/^iPhone with .+ \((?:large|medium) display\)\n/);
  });

  it("shows a standalone exact target without a removal or add options", () => {
    const standalone = { ...androidPhone, id: "feature-graphic", storeTargetId: "play-feature-graphic", artboard: { width: 1024, height: 500 } } as Screen;
    const model = sizesBarModel(layoutOf(standalone), standalone, specs);

    expect(model.groups[0]!.chips.map(({ label, role, removal }) => ({ label, role, removal }))).toEqual([
      { label: "Feature graphic", role: "variant", removal: null },
    ]);
    expect(model.addOptions).toEqual([]);
  });
});
