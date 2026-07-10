// SPDX-License-Identifier: Apache-2.0
import type { FontAsset } from "../model/schema.js";

/**
 * Browser-side font registration. Runs before any render so the project font is the
 * one that actually paints — the font-load race is the concrete failure mode behind the #1
 * parity risk (docs/architecture.md §5). Callers MUST await this and `whenFontsReady()` before
 * screenshotting; otherwise the first frame can render with a system fallback.
 */

export type ResolveFontUrl = (path: string) => string;

/** Register one project font with the document and wait for it to load. */
export async function registerFont(asset: FontAsset, resolve: ResolveFontUrl): Promise<void> {
  const response = await fetch(resolve(asset.path));
  if (!response.ok) {
    throw new Error(`Failed to load font "${asset.family}" from ${asset.path}: HTTP ${response.status}`);
  }
  const face = new FontFace(asset.family, await response.arrayBuffer(), {
    weight: String(asset.weight),
  });
  await face.load();
  document.fonts.add(face);
}

/** Register every project font, then wait for the font set to settle. */
export async function registerProjectFonts(fonts: FontAsset[], resolve: ResolveFontUrl): Promise<void> {
  await Promise.all(fonts.map((font) => registerFont(font, resolve)));
  await document.fonts.ready;
}

/**
 * Resolve once a specific family is usable at a given size. Belt-and-suspenders on top of
 * `document.fonts.ready` for the exact family/size a screen renders with.
 */
export async function whenFontReady(family: string, size: number): Promise<void> {
  await document.fonts.load(`${size}px "${family}"`);
}
