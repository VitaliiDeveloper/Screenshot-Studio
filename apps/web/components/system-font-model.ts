// SPDX-License-Identifier: Apache-2.0
import { fontIdentityKey, type FontAsset } from "@screenshot-studio/core/model";
import type { SystemFontCoverage, SystemFontFace } from "@screenshot-studio/cli/system-fonts";

export type { SystemFontCoverage, SystemFontFace };

/** A face with no entry yet is still loading. */
export type PreviewStatus = "ready" | "error";

export interface SystemFontFamily {
  name: string;
  faces: SystemFontFace[];
  coverage: SystemFontCoverage;
  hasSystemFaces: boolean;
}

export const COVERAGE_LABELS: ReadonlyArray<readonly [keyof SystemFontCoverage, string]> = [
  ["latin", "Latin"],
  ["latinExtA", "Latin Ext-A"],
  ["cyrillic", "Cyrillic"],
  ["greek", "Greek"],
];

export const PREVIEW_SAMPLES = {
  latin: "The quick brown fox 0123",
  cyrillic: "Чуєш їх, доцю, га? Без ґольфів!",
} as const;

export const SYSTEM_FONT_LICENSE_WARNING =
  "This family includes fonts installed system-wide. You are responsible for checking their license before using them in a project; for example, SF Pro is licensed only for UI mockups for Apple platforms.";

/** Preview faces use a private family so they can never paint project text or satisfy a project font. */
export function systemPreviewFamilyName(id: string): string {
  return `__system-preview-${id}`;
}

function sharedCoverage(faces: SystemFontFace[]): SystemFontCoverage {
  const usable = faces.filter((face) => !face.unavailable);
  const basis = usable.length > 0 ? usable : faces;
  return {
    latin: basis.every((face) => face.coverage.latin),
    latinExtA: basis.every((face) => face.coverage.latinExtA),
    cyrillic: basis.every((face) => face.coverage.cyrillic),
    greek: basis.every((face) => face.coverage.greek),
  };
}

export function groupSystemFontFamilies(faces: readonly SystemFontFace[]): SystemFontFamily[] {
  const byName = new Map<string, SystemFontFace[]>();
  for (const face of faces) byName.set(face.family, [...(byName.get(face.family) ?? []), face]);
  return [...byName]
    .map(([name, members]) => {
      const sorted = [...members].sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0) || a.style.localeCompare(b.style) || a.id.localeCompare(b.id));
      return {
        name,
        faces: sorted,
        coverage: sharedCoverage(sorted),
        hasSystemFaces: sorted.some((face) => face.source === "system"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function filterSystemFontFamilies(
  families: readonly SystemFontFamily[],
  query: string,
): SystemFontFamily[] {
  const needle = query.trim().toLowerCase();
  return needle ? families.filter((family) => family.name.toLowerCase().includes(needle)) : [...families];
}

export function isRegisteredSystemFace(face: SystemFontFace, registered: readonly FontAsset[]): boolean {
  return face.weight !== null
    && registered.some((font) => fontIdentityKey(font) === fontIdentityKey({ family: face.family, weight: face.weight! }));
}

/** Why a face cannot be ticked, or undefined when it can be imported. */
export function systemFaceDisabledReason(
  face: SystemFontFace,
  registered: readonly FontAsset[],
): string | undefined {
  if (face.unavailable) return face.unavailable;
  return isRegisteredSystemFace(face, registered)
    ? `Already in the project as "${face.family}" ${face.weight}`
    : undefined;
}

function faceLabel(face: SystemFontFace): string {
  return `${face.family} ${face.weight}`;
}

/** One sentence for a sequential import that finished or stopped at its first failure. */
export function describeSystemImport(
  imported: readonly SystemFontFace[],
  notImported: readonly SystemFontFace[],
  failure?: string,
): { tone: "success" | "error"; text: string } {
  const done = imported.length > 0 ? `Imported ${imported.map(faceLabel).join(", ")}.` : "";
  if (failure === undefined) return { tone: "success", text: done };
  const [failed, ...skipped] = notImported;
  return {
    tone: "error",
    text: [
      done,
      `${failed ? faceLabel(failed) : "Import"} failed: ${failure}`,
      skipped.length > 0 ? `Not imported: ${skipped.map(faceLabel).join(", ")}.` : "",
    ].filter(Boolean).join(" "),
  };
}
