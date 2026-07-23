// SPDX-License-Identifier: Apache-2.0
import {
  Screen as ScreenSchema,
  type Element,
  type Project as ProjectModel,
} from "./schema.js";
import { scaleLeafElement } from "./element-scale.js";
import { getLayout, replaceLayout } from "./project-layout.js";

/** Fit a screen composition into a target artboard without distorting render-bearing elements. */
export function fitElementsToArtboard(
  elements: readonly Element[],
  source: { width: number; height: number },
  target: { width: number; height: number },
): Element[] {
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const offsetX = (target.width - source.width * scale) / 2;
  const offsetY = (target.height - source.height * scale) / 2;
  return elements.map((element) => {
    if (element.type !== "group") return scaleLeafElement(element, scale, offsetX, offsetY);
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

/** Resize one screen artboard and fit its composition atomically. */
export function resizeScreenArtboard(
  project: ProjectModel,
  layoutId: string,
  screenId: string,
  target: { width: number; height: number },
): ProjectModel {
  const layout = getLayout(project, layoutId);
  const source = layout.screens.find((screen) => screen.id === screenId);
  if (!source) throw new Error(`Unknown screen "${screenId}"`);
  if (source.artboard.width === target.width && source.artboard.height === target.height) {
    return project;
  }

  const resized = ScreenSchema.parse({
    ...source,
    artboard: target,
    elements: fitElementsToArtboard(source.elements, source.artboard, target),
  });
  return replaceLayout(project, {
    ...layout,
    screens: layout.screens.map((screen) => screen.id === screenId ? resized : screen),
  });
}
