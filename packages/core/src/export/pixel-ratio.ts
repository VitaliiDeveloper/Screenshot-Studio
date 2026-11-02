// SPDX-License-Identifier: Apache-2.0
/**
 * Compute the pixelRatio that scales an artboard up to an exact store target size.
 * UI and CLI both export via `Stage.toDataURL({ pixelRatio })` (docs/architecture.md), so
 * this is the one place the design-size → export-size scale is derived. Konva-free on purpose,
 * so it is unit-testable in Node without pulling the browser renderer.
 */
export function exportPixelRatio(
  artboard: { width: number; height: number },
  target: { width: number; height: number },
): number {
  const ratioX = target.width / artboard.width;
  const ratioY = target.height / artboard.height;
  if (Math.abs(ratioX - ratioY) > 1e-6) {
    throw new Error(
      `Artboard ${artboard.width}×${artboard.height} aspect ratio does not match target ` +
        `${target.width}×${target.height}; export would distort.`,
    );
  }
  // Konva assigns `side * pixelRatio` to the integer canvas size, which truncates.
  const width = Math.trunc(artboard.width * ratioX);
  const height = Math.trunc(artboard.height * ratioX);
  if (width !== target.width || height !== target.height) {
    throw new Error(
      `Artboard ${artboard.width}×${artboard.height} would render at ${width}×${height}, not the ` +
        `exact target ${target.width}×${target.height}.`,
    );
  }
  return ratioX;
}
