import type { FontAsset } from "../model/schema.js";

/**
 * Browser-side font registration. Runs before any render so the embedded custom font is the
 * one that actually paints — the font-load race is the concrete failure mode behind the #1
 * parity risk (docs/architecture.md §5). Callers MUST await this and `whenFontsReady()` before
 * screenshotting; otherwise the first frame can render with a system fallback.
 */

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Register one embedded font with the document and wait for it to load. */
export async function registerFont(asset: FontAsset): Promise<void> {
  const face = new FontFace(asset.family, base64ToArrayBuffer(asset.data), {
    weight: String(asset.weight),
  });
  await face.load();
  document.fonts.add(face);
}

/** Register every embedded font in a project, then wait for the font set to settle. */
export async function registerProjectFonts(fonts: FontAsset[]): Promise<void> {
  await Promise.all(fonts.map(registerFont));
  await document.fonts.ready;
}

/**
 * Resolve once a specific family is usable at a given size. Belt-and-suspenders on top of
 * `document.fonts.ready` for the exact family/size a screen renders with.
 */
export async function whenFontReady(family: string, size: number): Promise<void> {
  await document.fonts.load(`${size}px "${family}"`);
}
