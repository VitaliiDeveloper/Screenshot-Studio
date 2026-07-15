// SPDX-License-Identifier: Apache-2.0
import {
  Screen as ScreenSchema,
  type Element,
  type Project as ProjectModel,
} from "./schema.js";
import { scaleLeafElement } from "./element-scale.js";

/** Fit a root composition into a target artboard without distorting render-bearing elements. */
export function fitElementsToArtboard(
  elements: readonly Element[],
  source: { width: number; height: number },
  target: { width: number; height: number },
): Element[] {
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const offsetX = (target.width - source.width * scale) / 2;
  const offsetY = (target.height - source.height * scale) / 2;
  return elements.map((element) => {
    if (element.type !== "group") {
      return scaleLeafElement(element, scale, { x: offsetX, y: offsetY });
    }
    return {
      ...element,
      x: element.x * scale + offsetX,
      y: element.y * scale + offsetY,
      width: element.width * scale,
      height: element.height * scale,
      children: element.children.map((child) => scaleLeafElement(child, scale)),
    };
  });
}

/** Resize one root artboard and fit its composition atomically; exact variants stay independent. */
export function resizeRootArtboard(
  project: ProjectModel,
  screenId: string,
  target: { width: number; height: number },
): ProjectModel {
  const source = project.screens.find((screen) => screen.id === screenId);
  if (!source) throw new Error(`Unknown screen "${screenId}"`);
  if (source.variantOf !== undefined || source.storeTargetId !== undefined) {
    throw new Error("Exact store-target variants have fixed artboards");
  }
  if (source.artboard.width === target.width && source.artboard.height === target.height) {
    return project;
  }

  const resized = ScreenSchema.parse({
    ...source,
    artboard: target,
    elements: fitElementsToArtboard(source.elements, source.artboard, target),
  });
  return {
    ...project,
    screens: project.screens.map((screen) => screen.id === screenId ? resized : screen),
  };
}
