// SPDX-License-Identifier: Apache-2.0
export type ToolbarDensity = "full" | "compact" | "overflow-secondary" | "overflow-locale" | "minimal";

export interface ToolbarDensityMeasurements {
  density: ToolbarDensity;
  currentGap: number;
  previousGap: number | null;
}

const ENTER_GAP = 20;
const RESTORE_GAP = 28;
const TOOLBAR_DENSITIES: ToolbarDensity[] = ["full", "compact", "overflow-secondary", "overflow-locale", "minimal"];

export function nextToolbarDensity(input: ToolbarDensityMeasurements): ToolbarDensity {
  const { density, currentGap, previousGap } = input;
  if (density === "full") return currentGap < ENTER_GAP ? "compact" : "full";
  if (density === "compact") {
    if (previousGap !== null && previousGap >= RESTORE_GAP) return "full";
    return currentGap < ENTER_GAP ? "overflow-secondary" : "compact";
  }
  if (density === "overflow-secondary") {
    if (previousGap !== null && previousGap >= RESTORE_GAP) return "compact";
    return currentGap < ENTER_GAP ? "overflow-locale" : "overflow-secondary";
  }
  if (density === "overflow-locale") {
    if (previousGap !== null && previousGap >= RESTORE_GAP) return "overflow-secondary";
    return currentGap < ENTER_GAP ? "minimal" : "overflow-locale";
  }
  return previousGap !== null && previousGap >= RESTORE_GAP ? "overflow-locale" : "minimal";
}

export function toolbarDensityProbeTarget(density: ToolbarDensity): ToolbarDensity | null {
  const index = TOOLBAR_DENSITIES.indexOf(density);
  return index > 0 ? TOOLBAR_DENSITIES[index - 1]! : null;
}

export function resolveToolbarDensityProbe({
  fallbackDensity,
  candidateDensity,
  candidateGap,
}: {
  fallbackDensity: ToolbarDensity;
  candidateDensity: ToolbarDensity;
  candidateGap: number;
}): ToolbarDensity {
  return candidateGap >= RESTORE_GAP ? candidateDensity : fallbackDensity;
}

export function toolbarGap({
  headerWidth,
  horizontalPadding,
  columnGap,
  leftWidth,
  centerWidth,
  rightWidth,
}: {
  headerWidth: number;
  horizontalPadding: number;
  columnGap: number;
  leftWidth: number;
  centerWidth: number;
  rightWidth: number;
}): number {
  const sideWidth = Math.max(0, (headerWidth - horizontalPadding - centerWidth - columnGap * 2) / 2);
  return columnGap + Math.min(sideWidth - leftWidth, sideWidth - rightWidth);
}

/** Any value that changes toolbar content width must be here, or cached widths go stale. */
export function toolbarMeasurementKey(values: ReadonlyArray<string | number | null>): string {
  return values.map((value) => value ?? "").join("\u0000");
}
