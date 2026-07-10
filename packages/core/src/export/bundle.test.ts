import { describe, expect, it } from "vitest";
import type { Project } from "../model/index.js";
import { parseStoreSpecs } from "./specs.js";
import {
  buildBundleEntries,
  bundleRelativePath,
  leadStoreSizeId,
  selectBundleScreens,
  validateBundleArtboards,
} from "./bundle.js";

const specs = parseStoreSpecs({
  apple: {
    iphone: [{ id: "6.9", label: "6.9", width: 1320, height: 2868, orientation: "portrait" }],
    ipad: [{ id: "13", label: "13", width: 2064, height: 2752, orientation: "portrait" }],
  },
  android: {
    phone: [{ id: "phone-portrait", label: "Phone", width: 1080, height: 1920, orientation: "portrait" }],
  },
});

function project(): Project {
  return {
    meta: { name: "Bundle", schemaVersion: 1 },
    platforms: ["apple", "android"],
    locales: ["en", "uk"],
    fonts: [],
    screens: [
      screen("hero", "Hero Phone", "apple", "iphone", "en", 1320, 2868),
      screen("ipad", "Hero iPad", "apple", "ipad", "en", 2064, 2752),
      screen("android", "Android Hero", "android", "phone", "uk", 1080, 1920),
    ],
  };
}

function screen(
  id: string,
  name: string,
  platform: "apple" | "android",
  device: "iphone" | "ipad" | "phone",
  locale: string,
  width: number,
  height: number,
): Project["screens"][number] {
  return {
    id,
    name,
    platform,
    device,
    locale,
    direction: "ltr",
    artboard: { width, height },
    background: { type: "solid", color: "#000000" },
    elements: [],
  } as Project["screens"][number];
}

describe("leadStoreSizeId", () => {
  it("returns the Phase 2 lead target per platform/device", () => {
    expect(leadStoreSizeId("apple", "iphone")).toBe("6.9");
    expect(leadStoreSizeId("apple", "ipad")).toBe("13");
    expect(leadStoreSizeId("android", "phone")).toBe("phone-portrait");
  });

  it("throws for an unsupported pair", () => {
    expect(() => leadStoreSizeId("android", "tablet" as never)).toThrow(/No lead store size/);
  });
});

describe("selectBundleScreens", () => {
  it("keeps project screen order and filters by platform/device/locale", () => {
    expect(selectBundleScreens(project(), { platform: "apple" }).map((s) => s.id)).toEqual(["hero", "ipad"]);
    expect(selectBundleScreens(project(), { device: "phone" }).map((s) => s.id)).toEqual(["android"]);
    expect(selectBundleScreens(project(), { locale: "en" }).map((s) => s.id)).toEqual(["hero", "ipad"]);
  });

  it("throws when filters match no screens", () => {
    expect(() => selectBundleScreens(project(), { locale: "fr" })).toThrow(/No screens match/);
  });
});

describe("bundleRelativePath", () => {
  it("builds a stable platform/device/locale path with a one-based order prefix", () => {
    const path = bundleRelativePath(project().screens[0]!, { id: "6.9" } as never, 0);
    expect(path).toBe("apple/iphone/en/01-hero-phone-6.9.png");
  });

  it("sanitizes empty names by falling back to the screen id", () => {
    const s = { ...project().screens[0]!, id: "s_1", name: "!!!" };
    expect(bundleRelativePath(s, { id: "6.9" } as never, 1)).toBe("apple/iphone/en/02-s-1-6.9.png");
  });
});

describe("buildBundleEntries", () => {
  it("attaches lead targets and relative paths", () => {
    const entries = buildBundleEntries(project(), specs, { platform: "apple" });
    expect(entries.map((e) => [e.screen.id, e.target.id, e.relativePath])).toEqual([
      ["hero", "6.9", "apple/iphone/en/01-hero-phone-6.9.png"],
      ["ipad", "13", "apple/ipad/en/02-hero-ipad-13.png"],
    ]);
  });

  it("throws if store-specs lacks the schema-supported lead target", () => {
    const broken = parseStoreSpecs({ apple: { iphone: [] }, android: { phone: [] } });
    expect(() => buildBundleEntries(project(), broken, { platform: "apple", device: "iphone" })).toThrow(
      /Unknown size/,
    );
  });
});

describe("validateBundleArtboards", () => {
  it("passes when every entry's artboard scales to its lead target", () => {
    const entries = buildBundleEntries(project(), specs, { platform: "apple" });
    expect(() => validateBundleArtboards(entries)).not.toThrow();
  });

  it("throws naming the screen and target when an artboard cannot scale", () => {
    const bad = project();
    bad.screens[0]!.artboard = { width: 1320, height: 2000 }; // wrong aspect for 6.9
    const entries = buildBundleEntries(bad, specs, { platform: "apple", device: "iphone" });
    expect(() => validateBundleArtboards(entries)).toThrow(/Hero Phone.*hero.*6\.9/);
  });
});
