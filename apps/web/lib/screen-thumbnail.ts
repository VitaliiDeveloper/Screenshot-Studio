// SPDX-License-Identifier: Apache-2.0
import { getLayout, projectScreenGroup, type Project } from "@screenshot-studio/core/model";
import type { ImageCache } from "@screenshot-studio/core/assets";

export interface ScreenThumbnailInput {
  project: Project;
  layoutId: string;
  screenId: string;
  images: ImageCache;
}

/** A connected crop depends on every screen in its exact group, including group order. */
export function screenThumbnailInputsEqual(
  previous: ScreenThumbnailInput,
  next: ScreenThumbnailInput,
): boolean {
  if (previous.images !== next.images || previous.screenId !== next.screenId || previous.layoutId !== next.layoutId) return false;
  const previousLayout = getLayout(previous.project, previous.layoutId);
  const nextLayout = getLayout(next.project, next.layoutId);
  if (previous.project.fonts !== next.project.fonts || previousLayout.mode !== nextLayout.mode) return false;
  if (previousLayout.mode === "isolated") {
    return previousLayout.screens.find((screen) => screen.id === previous.screenId)
      === nextLayout.screens.find((screen) => screen.id === next.screenId);
  }
  const previousGroup = projectScreenGroup(previous.project, previous.layoutId, previous.screenId);
  const nextGroup = projectScreenGroup(next.project, next.layoutId, next.screenId);
  return previousGroup.length === nextGroup.length && previousGroup.every((projection, index) => {
    const candidate = nextGroup[index];
    return projection.screen === candidate?.screen && projection.x === candidate.x;
  });
}
