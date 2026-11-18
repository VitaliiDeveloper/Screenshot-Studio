// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Element } from "@screenshot-studio/core/model";
import sharp from "sharp";
import { verifyNativePixels } from "./native-pixel-check.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const SOURCE = { width: 4, height: 6 };

function sourcePixels(alpha = 255): Buffer {
  const data = Buffer.alloc(SOURCE.width * SOURCE.height * 4);
  for (let i = 0; i < SOURCE.width * SOURCE.height; i += 1) {
    data.set([(i * 37) % 256, (i * 91) % 256, (i * 53) % 256, alpha], i * 4);
  }
  return data;
}

async function project(source: sharp.Sharp): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "native-pixels-"));
  roots.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets", "shot.png"), await source.png().toBuffer());
  return root;
}

const raw = (data: Buffer) => sharp(data, { raw: { ...SOURCE, channels: 4 } });

/** The finished 8×8 export: white artboard with the 4×5 crop (top inset 1) pasted at (2, 1). */
async function finished(edit?: (rgb: Buffer) => void): Promise<Buffer> {
  const crop = await raw(sourcePixels()).extract({ left: 0, top: 1, width: 4, height: 5 }).png().toBuffer();
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ffffff" } })
    .composite([{ input: crop, left: 2, top: 1 }])
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  edit?.(png.data);
  return sharp(png.data, { raw: { width: 8, height: 8, channels: 3 } }).png().toBuffer();
}

const screen = (shot: Partial<Element> = {}) => ({
  id: "hero",
  name: "Hero",
  elements: [{
    id: "shot", type: "screenshot", x: 2, y: 1, width: 4, height: 5, rotation: 0, opacity: 1,
    locked: false, visible: true, assetUrl: "assets/shot.png", fit: "native", cornerRadius: 0,
    nativeInsets: { top: 1, right: 0, bottom: 0, left: 0 },
    ...shot,
  } as Element],
});

describe("verifyNativePixels", () => {
  it("accepts a finished PNG whose region equals the cropped source", async () => {
    const root = await project(raw(sourcePixels()));
    await expect(verifyNativePixels({ png: await finished(), screen: screen(), pixelRatio: 1, root }))
      .resolves.toBeUndefined();
  });

  it("fails on one changed pixel and names the screen, layer and first difference", async () => {
    const root = await project(raw(sourcePixels()));
    const png = await finished((rgb) => {
      rgb[(3 * 8 + 4) * 3] ^= 1;
    });
    await expect(verifyNativePixels({ png, screen: screen(), pixelRatio: 1, root }))
      .rejects.toThrow(/Screen "Hero" \(hero\): 1:1 screenshot "shot" differs from its source in 1 pixel\(s\), first at \(2, 2\)/);
  });

  it("fails before comparing when export would scale the artboard", async () => {
    const root = await project(raw(sourcePixels()));
    await expect(verifyNativePixels({ png: await finished(), screen: screen(), pixelRatio: 2, root }))
      .rejects.toThrow(/would be scaled by 2/);
  });

  it("fails when the box differs from the cropped source", async () => {
    const root = await project(raw(sourcePixels()));
    await expect(verifyNativePixels({ png: await finished(), screen: screen({ height: 6 }), pixelRatio: 1, root }))
      .rejects.toThrow(/box 4×6 differs from the cropped source 4×5/);
  });

  it("rejects a transparent source", async () => {
    const root = await project(raw(sourcePixels(128)));
    await expect(verifyNativePixels({ png: await finished(), screen: screen(), pixelRatio: 1, root }))
      .rejects.toThrow(/transparent pixels/);
  });

  it("points at an embedded color profile when pixels differ", async () => {
    const root = await project(raw(sourcePixels()).withIccProfile("p3"));
    const png = await finished((rgb) => {
      rgb[(1 * 8 + 2) * 3] ^= 1;
    });
    await expect(verifyNativePixels({ png, screen: screen(), pixelRatio: 1, root }))
      .rejects.toThrow(/embedded color profile/);
  });
});
