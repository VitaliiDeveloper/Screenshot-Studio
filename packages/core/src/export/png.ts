// SPDX-License-Identifier: Apache-2.0
import { PNG } from "pngjs";

/**
 * PNG post-processing that runs in Node after the browser hands back rendered pixels.
 * The rendering itself happens in the browser (Konva `Stage.toDataURL`) — this module never
 * imports Konva, keeping the Node side framework-agnostic (docs/architecture.md §2).
 */

export interface PngInfo {
  width: number;
  height: number;
  /** True if the PNG *format* carries an alpha channel (color type 4 or 6), regardless of
   *  whether every pixel is opaque. Stores require the channel to be absent, not just opaque. */
  hasAlpha: boolean;
}

/** Decode a PNG buffer to raw RGBA + metadata. */
function decode(buffer: Buffer): PNG {
  return PNG.sync.read(buffer);
}

/** Color type lives in the IHDR chunk at a fixed byte offset (8 sig + 4 len + 4 tag + 4 w + 4 h
 *  + 1 bit depth = 25). Bit 2 (value 4) of the color type signals an alpha channel. */
function colorTypeOf(buffer: Buffer): number {
  return buffer[25]!;
}

/** Read dimensions and whether the PNG format includes an alpha channel. */
export function inspectPng(buffer: Buffer): PngInfo {
  const png = decode(buffer);
  return { width: png.width, height: png.height, hasAlpha: (colorTypeOf(buffer) & 4) !== 0 };
}

/**
 * Flatten a PNG onto an opaque background and re-encode with the alpha channel forced opaque.
 * Stores reject transparency: Apple requires flattened RGB, Google requires no transparency
 * (docs/architecture.md §4). Default background is white; callers may override.
 */
export function stripAlpha(buffer: Buffer, background = { r: 255, g: 255, b: 255 }): Buffer {
  const png = decode(buffer);
  const data = png.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!;
    if (alpha === 255) continue;
    const a = alpha / 255;
    data[i] = Math.round(data[i]! * a + background.r * (1 - a));
    data[i + 1] = Math.round(data[i + 1]! * a + background.g * (1 - a));
    data[i + 2] = Math.round(data[i + 2]! * a + background.b * (1 - a));
    data[i + 3] = 255;
  }
  // Emit true 24-bit RGB (color type 2): drop the alpha channel entirely, not merely set it
  // opaque. Apple requires flattened RGB and Google 24-bit PNG with no transparency (§4).
  return PNG.sync.write(png, { colorType: 2, inputColorType: 6 });
}

/** Assert a rendered PNG matches the expected store size exactly, or throw. */
export function assertDimensions(buffer: Buffer, expected: { width: number; height: number }): void {
  const info = inspectPng(buffer);
  if (info.width !== expected.width || info.height !== expected.height) {
    throw new Error(
      `Export dimension mismatch: got ${info.width}×${info.height}, expected ${expected.width}×${expected.height}`,
    );
  }
}

/** Decode base64 (optionally a `data:image/png;base64,...` URL) into a Buffer. */
export function base64PngToBuffer(dataUrlOrBase64: string): Buffer {
  const comma = dataUrlOrBase64.indexOf(",");
  const b64 = dataUrlOrBase64.startsWith("data:") && comma >= 0
    ? dataUrlOrBase64.slice(comma + 1)
    : dataUrlOrBase64;
  return Buffer.from(b64, "base64");
}
