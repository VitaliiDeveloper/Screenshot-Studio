import { projectScreenGroup, type Project } from "@screenshot-studio/core/model";
import type { ImageCache } from "@screenshot-studio/core/assets";

export interface ScreenThumbnailInput {
  project: Project;
  screenId: string;
  images: ImageCache;
}

/** A connected crop depends on every screen in its exact group, including group order. */
export function screenThumbnailInputsEqual(
  previous: ScreenThumbnailInput,
  next: ScreenThumbnailInput,
): boolean {
  if (previous.images !== next.images || previous.screenId !== next.screenId) return false;
  if (previous.project.fonts !== next.project.fonts || previous.project.mode !== next.project.mode) return false;
  if (previous.project.mode === "isolated") {
    return previous.project.screens.find((screen) => screen.id === previous.screenId)
      === next.project.screens.find((screen) => screen.id === next.screenId);
  }
  const previousGroup = projectScreenGroup(previous.project, previous.screenId);
  const nextGroup = projectScreenGroup(next.project, next.screenId);
  return previousGroup.length === nextGroup.length && previousGroup.every((projection, index) => {
    const candidate = nextGroup[index];
    return projection.screen === candidate?.screen && projection.x === candidate.x;
  });
}
