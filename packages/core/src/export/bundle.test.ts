// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { type DesignLayout, type Project } from "@screenshot-studio/core/model";
import {
  DEFAULT_STORE_SPECS,
  OUTPUT_DEVICE_FAMILIES,
  leadStoreSizeId,
} from "./specs.js";
import {
  buildBundleEntries,
  bundlePreflightWarnings,
  bundleRelativePath,
  safeLocalePathSegment,
  safeStoreSizePathToken,
  selectBundleScreens,
  validateBundleArtboards,
} from "./bundle.js";

const specs = DEFAULT_STORE_SPECS;

function project(): Project {
  return {
    meta: { name: "Bundle", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default", name: "Default", mode: "isolated",
      screens: [
        screen("hero", "Hero Phone", "apple", "iphone", "en", 1206, 2622),
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
    source.layouts[0]!.screens.push(screen("arabic", "Arabic", "apple", "iphone", "../ar", 1206, 2622));
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
    expect(path).toBe("apple/iphone/locale-en/size-6.9/01-hero-phone-6.9.png");
  });

  it("sanitizes empty names by falling back to the screen id", () => {
    const s = { ...project().layouts[0]!.screens[0]!, id: "s_1", name: "!!!" };
    expect(bundleRelativePath(s, { id: "6.9" } as never, 1)).toBe("apple/iphone/locale-en/size-6.9/02-s-1-6.9.png");
  });

  it("encodes a custom target id before composing the filename", () => {
    const path = bundleRelativePath(project().layouts[0]!.screens[0]!, { id: "6.9:alt*" } as never, 0);
    expect(path).toBe("apple/iphone/locale-en/size-6.9~003aalt~002a/01-hero-phone-6.9~003aalt~002a.png");
  });

  it.each([
    ["..", "size-.~002e"],
    [".", "size-~002e"],
    ["con", "size-con"],
    ["6.", "size-6~002e"],
  ])("keeps custom target id %j a portable directory segment", (id, segment) => {
    const path = bundleRelativePath(project().layouts[0]!.screens[0]!, { id } as never, 0);
    expect(path.split("/")[3]).toBe(segment);
  });
});

describe("buildBundleEntries", () => {
  it("attaches lead targets and relative paths", () => {
    const entries = buildBundleEntries(project(), "default", specs, { platform: "apple" });
    expect(entries.map((e) => [e.screen.id, e.target.id, e.relativePath])).toEqual([
      ["hero", "6.3", "apple/iphone/locale-en/size-6.3/01-hero-phone-6.3.png"],
      ["ipad", "13", "apple/ipad/locale-en/size-13/01-hero-ipad-13.png"],
    ]);
  });

  it("restarts numbering for exact interleaved platform/device/locale groups", () => {
    const source = project();
    const iphoneTwo = screen("hero-two", "Hero Two", "apple", "iphone", "en", 1206, 2622);
    const androidTwo = screen("android-two", "Android Two", "android", "phone", "uk", 1080, 1920);
    source.layouts[0]!.screens = [source.layouts[0]!.screens[0]!, source.layouts[0]!.screens[2]!, iphoneTwo, source.layouts[0]!.screens[1]!, androidTwo];

    expect(buildBundleEntries(source, "default", specs).map((entry) => entry.relativePath)).toEqual([
      "apple/iphone/locale-en/size-6.3/01-hero-phone-6.3.png",
      "android/phone/locale-uk/size-phone-portrait/01-android-hero-phone-portrait.png",
      "apple/iphone/locale-en/size-6.3/02-hero-two-6.3.png",
      "apple/ipad/locale-en/size-13/01-hero-ipad-13.png",
      "android/phone/locale-uk/size-phone-portrait/02-android-two-phone-portrait.png",
    ]);
  });

  it("exports explicit variants into their own size folder with independent numbering", () => {
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
      ["hero", "6.3", "apple/iphone/locale-en/size-6.3/01-hero-phone-6.3.png"],
      ["hero-65", "6.5", "apple/iphone/locale-en/size-6.5/01-hero-phone-6.5.png"],
    ]);
    expect(() => validateBundleArtboards(entries)).not.toThrow();
  });

  it("plans an iPhone Duo inner-display variant at its exact catalog size", () => {
    const source = project();
    source.layouts[0]!.screens.push({
      ...structuredClone(source.layouts[0]!.screens[0]!),
      id: "hero-duo",
      variantOf: "hero",
      storeTargetId: "duo-inner",
      artboard: { width: 2007, height: 2853 },
    });
    const entries = buildBundleEntries(source, "default", specs, { platform: "apple", device: "iphone" });
    expect(entries.map((entry) => [entry.target.id, entry.target.width, entry.target.height, entry.relativePath]))
      .toContainEqual(["duo-inner", 2007, 2853, "apple/iphone/locale-en/size-duo-inner/01-hero-phone-duo-inner.png"]);
    expect(() => validateBundleArtboards(entries)).not.toThrow();
  });

  it("throws if store-specs lacks the schema-supported lead target", () => {
    const broken = structuredClone(specs);
    broken.platforms.apple.families.iphone.targets = [];
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
    bad.layouts[0]!.screens[0]!.artboard = { width: 1320, height: 2000 }; // wrong aspect for 6.3
    const entries = buildBundleEntries(bad, "default", specs, { platform: "apple", device: "iphone" });
    expect(() => validateBundleArtboards(entries)).toThrow(/Hero Phone.*hero.*6\.3/);
  });

  it("points a primary screen authored at another family size to the lead migration", () => {
    const old = project();
    old.layouts[0]!.screens[0]!.artboard = { width: 1320, height: 2868 };
    const entries = buildBundleEntries(old, "default", specs, { platform: "apple", device: "iphone" });
    expect(() => validateBundleArtboards(entries, specs)).toThrow(
      'It matches "6.9"; if that was the previous lead size, run '
        + '"screenshots screen migrate-lead --platform apple --device iphone --from 6.9".',
    );
    expect(() => validateBundleArtboards(entries)).toThrow(/export would distort\.$/);
  });
});
