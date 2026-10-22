// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { FontAsset } from "@screenshot-studio/core/model";
import {
  describeSystemImport,
  filterSystemFontFamilies,
  groupSystemFontFamilies,
  systemFaceDisabledReason,
  systemPreviewFamilyName,
  type SystemFontFace,
} from "./system-font-model";

const all = { latin: true, latinExtA: true, cyrillic: true, greek: true };
const latinOnly = { latin: true, latinExtA: false, cyrillic: false, greek: false };

function face(id: string, family: string, weight: number | null, overrides: Partial<SystemFontFace> = {}): SystemFontFace {
  return { id, family, weight, style: "Regular", source: "user", format: "ttf", coverage: all, ...overrides };
}

const faces = [
  face("b700", "Beta", 700),
  face("a400", "Alpha", 400, { source: "system" }),
  face("b400", "Beta", 400, { coverage: latinOnly }),
  face("b900", "Beta", 900, { unavailable: "Variable fonts are not supported yet", coverage: latinOnly }),
];

describe("system font families", () => {
  it("groups faces by family, ordering families by name and faces by weight", () => {
    const families = groupSystemFontFamilies(faces);

    expect(families.map(({ name, faces: members }) => [name, members.map(({ weight }) => weight)]))
      .toEqual([["Alpha", [400]], ["Beta", [400, 700, 900]]]);
    expect(families.map(({ hasSystemFaces }) => hasSystemFaces)).toEqual([true, false]);
  });

  it("reports only coverage that every usable face shares", () => {
    const [, beta] = groupSystemFontFamilies(faces);

    expect(beta!.coverage).toEqual(latinOnly);
    expect(groupSystemFontFamilies([face("x", "X", 400), face("y", "X", 700, { coverage: latinOnly, unavailable: "no" })])[0]!.coverage)
      .toEqual(all);
  });

  it("filters by case-insensitive name and returns everything for a blank query", () => {
    const families = groupSystemFontFamilies(faces);

    expect(filterSystemFontFamilies(families, "  BET ").map(({ name }) => name)).toEqual(["Beta"]);
    expect(filterSystemFontFamilies(families, "zzz")).toEqual([]);
    expect(filterSystemFontFamilies(families, " ")).toHaveLength(2);
  });
});

describe("system face availability", () => {
  const registered: FontAsset[] = [
    { family: "Beta", weight: 700, source: "uploaded", path: "assets/fonts/beta-700.ttf" },
  ];

  it("disables unavailable faces with the scanner reason", () => {
    expect(systemFaceDisabledReason(faces[3]!, registered)).toBe("Variable fonts are not supported yet");
  });

  it("disables a face whose family and weight are already in the project, and only that one", () => {
    expect(systemFaceDisabledReason(faces[0]!, registered)).toBe('Already in the project as "Beta" 700');
    expect(systemFaceDisabledReason(faces[2]!, registered)).toBeUndefined();
  });

  it("namespaces preview families away from any project font", () => {
    expect(systemPreviewFamilyName("sf_1")).toBe("__system-preview-sf_1");
  });
});

describe("describeSystemImport", () => {
  const [beta700, beta400, beta900] = [faces[0]!, faces[2]!, faces[3]!];

  it("summarises a complete import", () => {
    expect(describeSystemImport([beta400, beta700], [])).toEqual({ tone: "success", text: "Imported Beta 400, Beta 700." });
  });

  it("names what was imported, what failed and what was skipped", () => {
    expect(describeSystemImport([beta400], [beta700, beta900], 'Font "Beta" 700 is already registered')).toEqual({
      tone: "error",
      text: 'Imported Beta 400. Beta 700 failed: Font "Beta" 700 is already registered Not imported: Beta 900.',
    });
  });
});
