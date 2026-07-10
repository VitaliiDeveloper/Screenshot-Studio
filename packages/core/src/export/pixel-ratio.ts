// SPDX-License-Identifier: Apache-2.0
/**
 * Compute the pixelRatio that scales an artboard up to an exact store target size.
 * UI and CLI both export via `Stage.toDataURL({ pixelRatio })` (docs/architecture.md §4), so
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
  return ratioX;
}
