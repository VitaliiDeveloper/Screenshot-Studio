import { describe, expect, it } from "vitest";
import { assertProjectFontsResolved } from "@screenshot-studio/core/model";
import { positionalArgs, resolveDevOptions, resolveExportMode, resolveImportOptions } from "./index.js";

describe("positionalArgs", () => {
  it("keeps subcommands and skips flag values", () => {
    expect(positionalArgs(["screen", "add", "--platform", "apple", "--locale", "en"])).toEqual([
      "screen",
      "add",
    ]);
  });
});

describe("resolveDevOptions", () => {
  it("resolves project path and numeric port", () => {
    expect(resolveDevOptions({ project: "./deck.json", port: "3456" })).toMatchObject({
      port: 3456,
    });
  });

  it("rejects a non-numeric port", () => {
    expect(() => resolveDevOptions({ port: "abc" })).toThrow(/--port/);
  });
});

describe("resolveImportOptions", () => {
  it("requires an input directory", () => {
    expect(() => resolveImportOptions([], {})).toThrow(/import <dir>/);
  });

  it("resolves input and project paths", () => {
    expect(resolveImportOptions(["captures"], { project: "./deck.json" }).inputDir).toMatch(/captures$/);
  });
});

describe("resolveExportMode", () => {
  it("keeps explicit single-screen export", () => {
    expect(resolveExportMode({ screen: "hero", size: "6.9" })).toEqual({
      kind: "single",
      screenId: "hero",
      sizeId: "6.9",
    });
  });

  it("defaults to bundle mode when no screen or size is supplied", () => {
    expect(resolveExportMode({})).toEqual({ kind: "bundle", filters: {} });
  });

  it("uses bundle filters when no screen is supplied", () => {
    expect(resolveExportMode({ platform: "apple", device: "ipad", locale: "en" })).toEqual({
      kind: "bundle",
      filters: { platform: "apple", device: "ipad", locale: "en" },
    });
  });

  it("rejects size without screen", () => {
    expect(() => resolveExportMode({ size: "6.9" })).toThrow(/--size requires --screen/);
  });

  it("rejects screen mixed with bundle filters", () => {
    expect(() => resolveExportMode({ screen: "hero", platform: "apple" })).toThrow(/cannot be combined/);
  });
});

describe("assertProjectFontsResolved", () => {
  it("blocks export before rendering when text resolves to a system fallback", () => {
    expect(() => assertProjectFontsResolved({
      meta: { name: "T", schemaVersion: 1 }, platforms: ["apple"], locales: ["en"], fonts: [],
      screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [{ id: "title", type: "text", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, locked: false, visible: true, content: "Title", fontFamily: "sans-serif", size: 24, weight: 400, lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF" }] }],
    })).toThrow(/unresolved project fonts.*sans-serif/);
  });
});
