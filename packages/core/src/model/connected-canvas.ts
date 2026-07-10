import type { Project, Screen } from "./schema.js";

/** One screen projected into its exact platform/device/locale strip. */
export interface ProjectedScreen {
  screen: Screen;
  x: number;
  y: 0;
}

export function sameScreenGroup(first: Screen, second: Screen): boolean {
  return first.platform === second.platform
    && first.device === second.device
    && first.locale === second.locale;
}

/**
 * Project an exact export group into a gapless, top-aligned horizontal strip in project order.
 * Screen/element storage remains unchanged; this is the single connected-coordinate derivation.
 */
export function projectScreenGroup(project: Project, screenId: string): ProjectedScreen[] {
  const target = project.screens.find((screen) => screen.id === screenId);
  if (!target) throw new Error(`Screen "${screenId}" not found`);

  let x = 0;
  return project.screens
    .filter((screen) => sameScreenGroup(screen, target))
    .map((screen) => {
      const projected = { screen, x, y: 0 as const };
      x += screen.artboard.width;
      return projected;
    });
}
