// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { OUTPUT_DEVICE_FAMILIES, type DesignLayout, type Project } from "@screenshot-studio/core/model";
import { parseStoreSpecs } from "./specs.js";
import {
  buildBundleEntries,
  bundlePreflightWarnings,
  bundleRelativePath,
  leadStoreSizeId,
  safeLocalePathSegment,
  safeStoreSizePathToken,
  selectBundleScreens,
  validateBundleArtboards,
} from "./bundle.js";

const specs = parseStoreSpecs({
  apple: {
    iphone: [
      { id: "6.9", label: "6.9", width: 1320, height: 2868, orientation: "portrait" },
      { id: "6.5", label: "6.5", width: 1284, height: 2778, orientation: "portrait" },
    ],
    ipad: [{ id: "13", label: "13", width: 2064, height: 2752, orientation: "portrait" }],
  },
  android: {
    phone: [{ id: "phone-portrait", label: "Phone", width: 1080, height: 1920, orientation: "portrait" }],
    "tablet-7": [{ id: "tablet-7-portrait", label: "Tablet", width: 1200, height: 1920, orientation: "portrait" }],
    "$outputs": [{ id: "play-feature-graphic", label: "Feature graphic", width: 1024, height: 500, orientation: "landscape", kind: "promotion", family: "phone" }],
  },
});

function project(): Project {
  return {
    meta: { name: "Bundle", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Default", mode: "isolated",
      screens: [
        screen("hero", "Hero Phone", "apple", "iphone", "en", 1320, 2868),
        screen("ipad", "Hero iPad", "apple", "ipad", "en", 2064, 2752),
        screen("android", "Android Hero", "android", "phone", "uk", 1080, 1920),
      ],
    }],
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
): DesignLayout["screens"][number] {
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
  } as DesignLayout["screens"][number];
}

describe("leadStoreSizeId", () => {
  it("delegates every platform/device lead to the output catalog", () => {
    for (const family of OUTPUT_DEVICE_FAMILIES) {
      const [platform, device] = family.key.split("/");
      expect(leadStoreSizeId(platform!, device!)).toBe(family.leadStoreSizeId);
    }
  });

  it("throws for an unsupported pair", () => {
    expect(() => leadStoreSizeId("android", "tablet" as never)).toThrow(/No lead store size/);
  });

  it("selects curated leads for the added destination families", () => {
    expect([
      leadStoreSizeId("apple", "visionos"),
      leadStoreSizeId("android", "chromebook"),
      leadStoreSizeId("android", "tv"),
      leadStoreSizeId("android", "wear"),
      leadStoreSizeId("android", "automotive"),
      leadStoreSizeId("android", "xr"),
      leadStoreSizeId("windows", "xbox"),
      leadStoreSizeId("windows", "holographic"),
    ]).toEqual([
      "vision-pro",
      "chromebook-landscape",
      "tv-landscape",
      "wear-square",
      "automotive-portrait",
      "xr-landscape",
      "full-hd",
      "minimum",
    ]);
  });
});

describe("bundlePreflightWarnings", () => {
  it("warns per Android tablet family and locale below four screens", () => {
    const source = project();
    source.layouts[0]!.screens = [1, 2, 3].map((index) => ({
      ...structuredClone(source.layouts[0]!.screens[2]!),
      id: `tablet-${index}`,
      name: `Tablet ${index}`,
      device: "tablet-7",
      artboard: { width: 1200, height: 1920 },
    })) as DesignLayout["screens"];
    const entries = buildBundleEntries(source, "default", specs);
    expect(bundlePreflightWarnings(entries)).toEqual([expect.objectContaining({
      code: "android-tablet-screen-count", device: "tablet-7", locale: "uk", screenCount: 3,
      message: "Google Play · Android tablet locale uk has 3 screens; four or more are recommended.",
    })]);
    source.layouts[0]!.screens.push({ ...structuredClone(source.layouts[0]!.screens[0]!), id: "tablet-4" });
    expect(bundlePreflightWarnings(buildBundleEntries(source, "default", specs))).toEqual([]);
  });
});

describe("selectBundleScreens", () => {
  it("keeps project screen order and filters by platform/device/locale", () => {
    expect(selectBundleScreens(project(), "default", { platform: "apple" }).map((s) => s.id)).toEqual(["hero", "ipad"]);
    expect(selectBundleScreens(project(), "default", { device: "phone" }).map((s) => s.id)).toEqual(["android"]);
    expect(selectBundleScreens(project(), "default", { locale: "en" }).map((s) => s.id)).toEqual(["hero", "ipad"]);
  });

  it("throws when filters match no screens", () => {
    expect(() => selectBundleScreens(project(), "default", { locale: "fr" })).toThrow(/No screens match/);
  });

  it("matches a free-form locale exactly", () => {
    const source = project();
    source.layouts[0]!.screens.push(screen("arabic", "Arabic", "apple", "iphone", "../ar", 1320, 2868));
    expect(selectBundleScreens(source, "default", { locale: "../ar" }).map((candidate) => candidate.id)).toEqual(["arabic"]);
    expect(() => selectBundleScreens(source, "default", { locale: "ar" })).toThrow(/No screens match/);
  });
});

describe("safeLocalePathSegment", () => {
  it("keeps common lowercase tags readable and escapes path traversal", () => {
    expect(safeLocalePathSegment("en")).toBe("locale-en");
    expect(safeLocalePathSegment("../ar")).toBe("locale-~002e~002e~002far");
    expect(safeLocalePathSegment("../ar")).not.toMatch(/[\\/]/);
  });

  it("preserves exact identity for case, separators, and non-Latin locales", () => {
    const segments = ["en-US", "en_US", "en-us", "العربية"].map(safeLocalePathSegment);
    expect(new Set(segments).size).toBe(segments.length);
    expect(segments[3]).toMatch(/^locale-(?:~[0-9a-f]{4})+$/);
  });

  it("rejects identifiers that exceed a portable path component", () => {
    expect(() => safeLocalePathSegment("العربية".repeat(10))).toThrow(/too long/);
  });
});

describe("safeStoreSizePathToken", () => {
  it("preserves shipped ids and escapes custom Windows/path punctuation", () => {
    expect(safeStoreSizePathToken("6.9")).toBe("6.9");
    expect(safeStoreSizePathToken("6.9:alt*")).toBe("6.9~003aalt~002a");
    expect(safeStoreSizePathToken("../../outside")).toBe("..~002f..~002foutside");
  });
});

describe("bundleRelativePath", () => {
  it("builds a stable platform/device/locale path with a one-based order prefix", () => {
    const path = bundleRelativePath(project().layouts[0]!.screens[0]!, { id: "6.9" } as never, 0);
    expect(path).toBe("apple/iphone/locale-en/01-hero-phone-6.9.png");
  });

  it("sanitizes empty names by falling back to the screen id", () => {
    const s = { ...project().layouts[0]!.screens[0]!, id: "s_1", name: "!!!" };
    expect(bundleRelativePath(s, { id: "6.9" } as never, 1)).toBe("apple/iphone/locale-en/02-s-1-6.9.png");
  });

  it("encodes a custom target id before composing the filename", () => {
    const path = bundleRelativePath(project().layouts[0]!.screens[0]!, { id: "6.9:alt*" } as never, 0);
    expect(path).toBe("apple/iphone/locale-en/01-hero-phone-6.9~003aalt~002a.png");
  });
});

describe("buildBundleEntries", () => {
  it("attaches lead targets and relative paths", () => {
    const entries = buildBundleEntries(project(), "default", specs, { platform: "apple" });
    expect(entries.map((e) => [e.screen.id, e.target.id, e.relativePath])).toEqual([
      ["hero", "6.9", "apple/iphone/locale-en/01-hero-phone-6.9.png"],
      ["ipad", "13", "apple/ipad/locale-en/01-hero-ipad-13.png"],
    ]);
  });

  it("restarts numbering for exact interleaved platform/device/locale groups", () => {
    const source = project();
    const iphoneTwo = screen("hero-two", "Hero Two", "apple", "iphone", "en", 1320, 2868);
    const androidTwo = screen("android-two", "Android Two", "android", "phone", "uk", 1080, 1920);
    source.layouts[0]!.screens = [source.layouts[0]!.screens[0]!, source.layouts[0]!.screens[2]!, iphoneTwo, source.layouts[0]!.screens[1]!, androidTwo];

    expect(buildBundleEntries(source, "default", specs).map((entry) => entry.relativePath)).toEqual([
      "apple/iphone/locale-en/01-hero-phone-6.9.png",
      "android/phone/locale-uk/01-android-hero-phone-portrait.png",
      "apple/iphone/locale-en/02-hero-two-6.9.png",
      "apple/ipad/locale-en/01-hero-ipad-13.png",
      "android/phone/locale-uk/02-android-two-phone-portrait.png",
    ]);
  });

  it("exports explicit variants against their own target with independent numbering", () => {
    const source = project();
    source.layouts[0]!.screens.push({
      ...structuredClone(source.layouts[0]!.screens[0]!),
      id: "hero-65",
      variantOf: "hero",
      storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
    });
    const entries = buildBundleEntries(source, "default", specs, { platform: "apple", device: "iphone" });
    expect(entries.map((entry) => [entry.screen.id, entry.target.id, entry.relativePath])).toEqual([
      ["hero", "6.9", "apple/iphone/locale-en/01-hero-phone-6.9.png"],
      ["hero-65", "6.5", "apple/iphone/locale-en/01-hero-phone-6.5.png"],
    ]);
    expect(() => validateBundleArtboards(entries)).not.toThrow();
  });

  it("throws if store-specs lacks the schema-supported lead target", () => {
    const broken = parseStoreSpecs({ apple: { iphone: [] }, android: { phone: [] } });
    expect(() => buildBundleEntries(project(), "default", broken, { platform: "apple", device: "iphone" })).toThrow(
      /Unknown target/,
    );
  });

  it("rejects an explicit variant whose target id is absent from store specs", () => {
    const source = project();
    source.layouts[0]!.screens.push({
      ...structuredClone(source.layouts[0]!.screens[0]!),
      id: "hero-unknown",
      variantOf: "hero",
      storeTargetId: "unknown-target",
    });
    expect(() => buildBundleEntries(source, "default", specs)).toThrow(/Unknown target.*unknown-target/);
  });

  it("resolves a Play promotion variant without modeling promotion as a device", () => {
    const source = project();
    const root = source.layouts[0]!.screens[2]!;
    source.layouts[0]!.screens.push({
      ...structuredClone(root),
      id: "feature-graphic",
      variantOf: root.id,
      storeTargetId: "play-feature-graphic",
      artboard: { width: 1024, height: 500 },
    });
    const entry = buildBundleEntries(source, "default", specs)
      .find(({ screen }) => screen.id === "feature-graphic")!;
    expect(entry.target).toMatchObject({ id: "play-feature-graphic", kind: "promotion" });
    expect(entry.screen.device).toBe("phone");
    expect(() => validateBundleArtboards([entry])).not.toThrow();
  });
});

describe("validateBundleArtboards", () => {
  it("passes when every entry's artboard scales to its lead target", () => {
    const entries = buildBundleEntries(project(), "default", specs, { platform: "apple" });
    expect(() => validateBundleArtboards(entries)).not.toThrow();
  });

  it("throws naming the screen and target when an artboard cannot scale", () => {
    const bad = project();
    bad.layouts[0]!.screens[0]!.artboard = { width: 1320, height: 2000 }; // wrong aspect for 6.9
    const entries = buildBundleEntries(bad, "default", specs, { platform: "apple", device: "iphone" });
    expect(() => validateBundleArtboards(entries)).toThrow(/Hero Phone.*hero.*6\.9/);
  });
});
