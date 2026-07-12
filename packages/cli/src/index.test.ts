// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { assertProjectFontsResolved } from "@screenshot-studio/core/model";
import { COMMAND_FLAG_SPECS, parseCommandFlags } from "./command-flags.js";
import {
  positionalArgs,
  resolveDevOptions,
  resolveExportMode,
  resolveImportOptions,
  singleExportFilename,
  singleExportTargetId,
} from "./index.js";

describe("parseCommandFlags", () => {
  it("parses positional arguments plus declared value and boolean options", () => {
    expect(parseCommandFlags(
      ["add", "--project", "deck.json", "--verbose"],
      { value: ["project"], boolean: ["verbose"] },
    )).toEqual({
      args: ["add"],
      flags: { project: "deck.json", verbose: "true" },
    });
  });

  it("rejects an unknown option", () => {
    expect(() => parseCommandFlags(["--wat"], { value: [], boolean: [] }))
      .toThrow(/Unknown option --wat/);
  });

  it("rejects a missing option value", () => {
    expect(() => parseCommandFlags(
      ["--project", "--verbose"],
      { value: ["project"], boolean: ["verbose"] },
    )).toThrow(/--project requires a value/);
  });

  it.each([
    ["init", ["dir", "name"]],
    ["export", ["project", "store-specs", "out", "screen", "size", "platform", "device", "locale"]],
    ["screen", ["project", "store-specs", "platform", "device", "locale", "id", "name", "direction", "size", "to"]],
    ["dev", ["project", "store-specs", "port"]],
    ["import", ["project"]],
    ["font", ["project", "weight", "google", "family"]],
    ["theme", ["project"]],
    ["locale", ["project", "from", "direction", "to"]],
    ["asset", ["project", "threshold", "background", "tolerance"]],
    ["canvas", ["project"]],
  ] as const)("retains every supported %s option", (command, options) => {
    const argv = options.flatMap((option) => [`--${option}`, `${option}-value`]);
    expect(parseCommandFlags(argv, COMMAND_FLAG_SPECS[command]).flags).toEqual(
      Object.fromEntries(options.map((option) => [option, `${option}-value`])),
    );
  });
});

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

  it("rejects an unknown platform filter", () => {
    expect(() => resolveExportMode({ platform: "ios" })).toThrow(/Unsupported platform filter: ios/);
  });

  it("rejects an unknown device filter", () => {
    expect(() => resolveExportMode({ device: "tablet" })).toThrow(/Unsupported device filter: tablet/);
  });

  it("rejects a device that does not belong to the selected platform", () => {
    expect(() => resolveExportMode({ platform: "android", device: "iphone" }))
      .toThrow(/Unsupported platform\/device filter pair: android\/iphone/);
  });
});

describe("singleExportFilename", () => {
  it("uses the same safe locale segment as bundle export", () => {
    expect(singleExportFilename(
      { platform: "apple", device: "iphone", locale: "../ar" },
      { id: "6.9" },
    )).toBe("apple-iphone-6.9-locale-~002e~002e~002far.png");
  });

  it("encodes a custom store-size id at the filename sink", () => {
    expect(singleExportFilename(
      { platform: "apple", device: "iphone", locale: "en" },
      { id: "6.9:alt*" },
    )).toBe("apple-iphone-6.9~003aalt~002a-locale-en.png");
  });
});

describe("singleExportTargetId", () => {
  const variant = {
    platform: "apple" as const,
    device: "iphone" as const,
    storeTargetId: "6.5",
  };

  it("defaults an explicit variant screen to its persisted target", () => {
    expect(singleExportTargetId(variant)).toBe("6.5");
  });

  it("keeps an explicit --size override authoritative", () => {
    expect(singleExportTargetId(variant, "6.3")).toBe("6.3");
  });
});

describe("assertProjectFontsResolved", () => {
  it("blocks export before rendering when text resolves to a system fallback", () => {
    expect(() => assertProjectFontsResolved({
      meta: { name: "T", schemaVersion: 10 }, mode: "isolated", platforms: ["apple"], locales: ["en"], fonts: [],
      screens: [{ id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", direction: "ltr", artboard: { width: 660, height: 1434 }, background: { type: "solid", color: "#111111" }, elements: [{ id: "title", type: "text", x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, locked: false, visible: true, content: "Title", fontFamily: "sans-serif", size: 24, weight: 400, lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF" }] }],
    })).toThrow(/unresolved project fonts.*sans-serif/);
  });
});
