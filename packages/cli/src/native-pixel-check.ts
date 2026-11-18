// SPDX-License-Identifier: Apache-2.0
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import {
  getLayout,
  nativePlacements,
  nativeSourceRect,
  type Project,
  type Screen,
} from "@screenshot-studio/core/model";
import sharp from "sharp";
import { assertInside } from "./asset-service.js";

async function resolveProjectImage(root: string, assetUrl: string): Promise<string> {
  if (isAbsolute(assetUrl)) throw new Error(`Project image path must be relative: ${assetUrl}`);
  const realRoot = await realpath(root);
  const target = await realpath(resolve(realRoot, assetUrl));
  assertInside(realRoot, target, "Project image");
  return target;
}

/** Decoded sizes of the layout's 1:1 screenshot sources, for the Issues engine in Node. */
export async function nativeImageSizes(
  project: Project,
  layoutId: string,
  root: string,
): Promise<Map<string, { width: number; height: number }>> {
  const assetUrls = new Set(getLayout(project, layoutId).screens
    .flatMap((screen) => nativePlacements(screen).map(({ element }) => element.assetUrl)));
  const sizes = new Map<string, { width: number; height: number }>();
  await Promise.all([...assetUrls].map(async (assetUrl) => {
    try {
      const { width, height } = await sharp(await resolveProjectImage(root, assetUrl)).metadata();
      if (width && height) sizes.set(assetUrl, { width, height });
    } catch {
      // A missing or unreadable image is the missing-image issue's job.
    }
  }));
  return sizes;
}

/**
 * Proves every visible 1:1 screenshot of `screen` reached the finished PNG unchanged: its box region
 * must hold exactly the source's stored RGB values for the cropped rect. Decoded pixels are compared,
 * not file bytes, because the export re-encodes the PNG. Throws a message naming the screen and layer.
 */
export async function verifyNativePixels({
  png,
  screen,
  pixelRatio,
  root,
}: {
  png: Buffer;
  screen: Pick<Screen, "id" | "name" | "elements">;
  pixelRatio: number;
  root: string;
}): Promise<void> {
  const placements = nativePlacements(screen as Screen);
  if (placements.length === 0) return;
  const output = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const { element, x, y } of placements) {
    const fail = (reason: string): never => {
      throw new Error(`Screen "${screen.name}" (${screen.id}): 1:1 screenshot "${element.id}" ${reason}`);
    };
    if (Math.abs(pixelRatio - 1) > 1e-9) {
      fail(`would be scaled by ${pixelRatio}: the artboard must be at the export size`);
    }
    if (!Number.isInteger(x) || !Number.isInteger(y)) fail(`is not on whole pixels (${x}, ${y})`);
    const sourcePath = await resolveProjectImage(root, element.assetUrl);
    const source = sharp(sourcePath, { ignoreIcc: true });
    const meta = await source.metadata();
    if (meta.format !== "png") fail(`needs a PNG source, got ${meta.format ?? "an unknown format"}`);
    if (meta.depth !== "uchar") fail("needs an 8-bit PNG source");
    const decoded = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rect = nativeSourceRect(decoded.info, element, element.nativeInsets);
    if (rect.width !== element.width || rect.height !== element.height) {
      fail(`box ${element.width}×${element.height} differs from the cropped source ${rect.width}×${rect.height}`);
    }
    if (x < 0 || y < 0 || x + rect.width > output.info.width || y + rect.height > output.info.height) {
      fail("is not entirely on the artboard");
    }
    let mismatches = 0;
    let first: { x: number; y: number } | null = null;
    for (let row = 0; row < rect.height; row += 1) {
      for (let column = 0; column < rect.width; column += 1) {
        const s = ((rect.y + row) * decoded.info.width + rect.x + column) * 4;
        if (decoded.data[s + 3] !== 255) fail("has transparent pixels; 1:1 needs an opaque screenshot");
        const o = ((y + row) * output.info.width + x + column) * output.info.channels;
        if (decoded.data[s] !== output.data[o] || decoded.data[s + 1] !== output.data[o + 1]
          || decoded.data[s + 2] !== output.data[o + 2]) {
          mismatches += 1;
          first ??= { x: column, y: row };
        }
      }
    }
    if (first) {
      const hint = meta.icc ? " The source has an embedded color profile; convert it to untagged sRGB." : "";
      fail(`differs from its source in ${mismatches} pixel(s), first at (${first.x}, ${first.y}) of the cropped `
        + `shot. Check for layers drawn over it.${hint}`);
    }
  }
}
