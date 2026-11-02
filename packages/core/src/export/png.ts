// SPDX-License-Identifier: Apache-2.0
import { PNG } from "pngjs";

/**
 * PNG inspection that runs in Node after the browser hands back rendered pixels.
 * The rendering itself happens in the browser (Konva `Stage.toDataURL`) — this module never
 * imports Konva, keeping the Node side framework-agnostic (docs/architecture.md).
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

/** Largest image, in pixels, accepted from untrusted bytes before decoding allocates it. */
export const MAX_IMAGE_PIXELS = 80_000_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** IHDR is always the first chunk, so the size is known from bytes 16-23 without decoding. */
function assertPixelLimit(buffer: Buffer): void {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)
    || buffer.toString("latin1", 12, 16) !== "IHDR") return;
  if (buffer.readUInt32BE(16) * buffer.readUInt32BE(20) > MAX_IMAGE_PIXELS) {
    throw new Error(`PNG exceeds ${MAX_IMAGE_PIXELS} pixels`);
  }
}

/** Read dimensions and whether the PNG format includes an alpha channel. */
export function inspectPng(buffer: Buffer): PngInfo {
  assertPixelLimit(buffer);
  const png = decode(buffer);
  return { width: png.width, height: png.height, hasAlpha: (colorTypeOf(buffer) & 4) !== 0 };
}

/** Decode base64 (optionally a `data:image/png;base64,...` URL) into a Buffer. */
export function base64PngToBuffer(dataUrlOrBase64: string): Buffer {
  const comma = dataUrlOrBase64.indexOf(",");
  const b64 = dataUrlOrBase64.startsWith("data:") && comma >= 0
    ? dataUrlOrBase64.slice(comma + 1)
    : dataUrlOrBase64;
  return Buffer.from(b64, "base64");
}
