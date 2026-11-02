// SPDX-License-Identifier: Apache-2.0
import { PNG } from "pngjs";

/** Parity comparison helper: the product flattens exports with sharp in `store-ready-png.ts`. */
export function stripAlpha(buffer: Buffer): Buffer {
  const png = PNG.sync.read(buffer);
  const data = png.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]! / 255;
    data[i] = Math.round(data[i]! * a + 255 * (1 - a));
    data[i + 1] = Math.round(data[i + 1]! * a + 255 * (1 - a));
    data[i + 2] = Math.round(data[i + 2]! * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
  return PNG.sync.write(png, { colorType: 2, inputColorType: 6 });
}
