// SPDX-License-Identifier: Apache-2.0
import { exportPixelRatio } from "./pixel-ratio.js";
import { listStoreTargets, type StoreSize, type StoreSpecs } from "./specs.js";
import type { Screen } from "../model/index.js";

/**
 * Framework-free artboard/target compatibility (spec Slice 3). Classifies an artboard against a
 * store target the same way `exportPixelRatio` would treat it at export time, so the editor can
 * warn before export instead of failing at render. No React/Next/Playwright/fs imports.
 */
export type ArtboardTargetStatus =
  | { kind: "exact"; pixelRatio: number }
  | { kind: "proportional"; pixelRatio: number }
  | { kind: "invalid"; message: string };

export function artboardTargetStatus(
  artboard: { width: number; height: number },
  target: { width: number; height: number },
): ArtboardTargetStatus {
  let pixelRatio: number;
  try {
    pixelRatio = exportPixelRatio(artboard, target);
  } catch (err) {
    return { kind: "invalid", message: err instanceof Error ? err.message : String(err) };
  }
  const exact = artboard.width === target.width && artboard.height === target.height;
  return { kind: exact ? "exact" : "proportional", pixelRatio };
}

export interface ArtboardTargetStatusEntry {
  target: StoreSize;
  status: ArtboardTargetStatus;
}

/** Status for every device-size or non-device output target owned by the screen family. */
export function artboardTargetStatuses(screen: Screen, specs: StoreSpecs): ArtboardTargetStatusEntry[] {
  try {
    return listStoreTargets(specs, screen.platform, screen.device)
      .map((target) => ({ target, status: artboardTargetStatus(screen.artboard, target) }));
  } catch {
    return [];
  }
}
