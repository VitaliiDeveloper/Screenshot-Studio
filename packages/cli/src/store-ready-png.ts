// SPDX-License-Identifier: Apache-2.0
import type { Screen } from "@screenshot-studio/core/model";
import { exportPixelRatio, type StoreSize } from "@screenshot-studio/core/export";
import sharp from "sharp";

export async function renderStoreReadyPng({
  screen,
  target,
  render,
}: {
  screen: Pick<Screen, "artboard">;
  target: Pick<StoreSize, "width" | "height">;
  render: (pixelRatio: number) => Promise<Buffer>;
}): Promise<Buffer> {
  const pixelRatio = exportPixelRatio(screen.artboard, {
    width: target.width,
    height: target.height,
  });
  const rendered = await render(pixelRatio);
  const { data, info } = await sharp(rendered)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .png()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== target.width || info.height !== target.height) {
    throw new Error(
      `Export dimension mismatch: got ${info.width}×${info.height}, expected ${target.width}×${target.height}`,
    );
  }
  return data;
}
