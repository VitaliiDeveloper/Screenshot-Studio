// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { parseStoreSpecs, findStoreSize, findStoreTarget } from "./specs.js";
import { stripAlpha, inspectPng, assertDimensions, base64PngToBuffer } from "./png.js";

const storeSpecsRaw = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../../store-specs.json", import.meta.url)), "utf8"),
);

/** Build a small PNG with a semi-transparent pixel for the alpha tests. */
function makePng(width: number, height: number, alpha: number): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 200;
    png.data[i + 1] = 100;
    png.data[i + 2] = 50;
    png.data[i + 3] = alpha;
  }
  return PNG.sync.write(png);
}

describe("store-specs.json", () => {
  it("validates and exposes the apple/iphone lead size the fixture targets", () => {
    const specs = parseStoreSpecs(storeSpecsRaw);
    const lead = findStoreSize(specs, "apple", "iphone", "6.9");
    expect(lead.width).toBe(1320);
    expect(lead.height).toBe(2868);
  });

  it("throws for an unknown size id, listing valid options", () => {
    const specs = parseStoreSpecs(storeSpecsRaw);
    expect(() => findStoreSize(specs, "apple", "iphone", "5.5")).toThrow(/Known:/);
  });

  it("declares Android variants, tablet outputs, promotion art, and responsive Web sizes exactly", () => {
    const specs = parseStoreSpecs(storeSpecsRaw);
    expect(findStoreSize(specs, "android", "phone", "phone-portrait-high-res")).toMatchObject({ width: 1440, height: 2560 });
    expect(findStoreSize(specs, "android", "tablet-7", "tablet-7-landscape")).toMatchObject({ width: 1920, height: 1200 });
    expect(findStoreSize(specs, "android", "tablet-10", "tablet-10-portrait")).toMatchObject({ width: 1600, height: 2560 });
    expect(findStoreTarget(specs, "android", "phone", "play-feature-graphic")).toMatchObject({
      width: 1024, height: 500, kind: "promotion", family: "phone", alpha: false,
    });
    expect(() => findStoreSize(specs, "android", "promotion", "play-feature-graphic")).toThrow(/No store sizes/);
    expect(findStoreSize(specs, "web", "desktop", "desktop-1920")).toMatchObject({ width: 1920, height: 1080, kind: "responsive" });
    expect(findStoreSize(specs, "web", "mobile", "mobile-portrait")).toMatchObject({ width: 390, height: 844, kind: "responsive" });
  });
});

describe("stripAlpha", () => {
  it("flattens transparency onto the background and forces opacity", () => {
    const semi = makePng(4, 4, 0); // fully transparent → becomes pure background
    const flattened = stripAlpha(semi, { r: 255, g: 255, b: 255 });
    const info = inspectPng(flattened);
    expect(info.hasAlpha).toBe(false);

    const decoded = PNG.sync.read(flattened);
    expect(decoded.data[0]).toBe(255); // r == background
    expect(decoded.data[3]).toBe(255); // alpha forced opaque
  });

  it("reports the alpha channel by format presence, not opacity", () => {
    // makePng always writes RGBA (color type 6), so the channel is present even when opaque.
    expect(inspectPng(makePng(2, 2, 128)).hasAlpha).toBe(true);
    expect(inspectPng(makePng(2, 2, 255)).hasAlpha).toBe(true);
    // Only stripping removes the channel entirely.
    expect(inspectPng(stripAlpha(makePng(2, 2, 128))).hasAlpha).toBe(false);
  });
});

describe("assertDimensions", () => {
  it("passes on an exact match and throws otherwise", () => {
    const png = makePng(10, 20, 255);
    expect(() => assertDimensions(png, { width: 10, height: 20 })).not.toThrow();
    expect(() => assertDimensions(png, { width: 10, height: 21 })).toThrow(/mismatch/);
  });
});

describe("base64PngToBuffer", () => {
  it("handles both raw base64 and data URLs", () => {
    const png = makePng(2, 2, 255);
    const b64 = png.toString("base64");
    expect(base64PngToBuffer(b64).equals(png)).toBe(true);
    expect(base64PngToBuffer(`data:image/png;base64,${b64}`).equals(png)).toBe(true);
  });
});
