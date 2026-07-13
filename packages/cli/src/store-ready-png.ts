// SPDX-License-Identifier: Apache-2.0
import type { Screen } from "@screenshot-studio/core/model";
import {
  assertDimensions,
  exportPixelRatio,
  stripAlpha,
  type StoreSize,
} from "@screenshot-studio/core/export";

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
  const flattened = stripAlpha(await render(pixelRatio));
  assertDimensions(flattened, { width: target.width, height: target.height });
  return flattened;
}
