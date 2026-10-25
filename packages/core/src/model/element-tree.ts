// SPDX-License-Identifier: Apache-2.0
import type { Background, Element, LeafElement } from "./schema.js";

/** Visit existing render-bearing leaves without exposing persistence consumers to tree shape. */
export function elementLeaves(element: Element): LeafElement[] {
  return element.type === "group" ? element.children : [element];
}

export function mapElementLeaves(
  element: Element,
  transform: (leaf: LeafElement) => LeafElement,
): Element {
  return element.type === "group"
    ? { ...element, children: element.children.map(transform) }
    : transform(element);
}

export function cloneElementWithFreshIds(
  element: Element,
  createId: () => string = () => crypto.randomUUID(),
): Element {
  const copy = structuredClone(element);
  copy.id = createId();
  if (copy.type === "group") {
    copy.children = copy.children.map((child) => ({ ...child, id: createId() }));
  }
  return copy;
}

/** Reflect a linear-gradient angle (0 = left-to-right, 90 = top-to-bottom) horizontally. */
export function mirrorGradientAngle(angle: number): number {
  return (180 - angle + 360) % 360;
}

/** Screen backgrounds reflect only a gradient's direction; image pixels stay as they are. */
export function mirrorBackground(background: Background): Background {
  return background.type === "linear-gradient"
    ? { ...background, angle: mirrorGradientAngle(background.angle) }
    : background;
}

// Konva rotates around the top-left corner, so the mirrored box starts at the reflected top-right corner.
function mirrorPlacement<T extends Element>(element: T, width: number): T {
  const radians = element.rotation * Math.PI / 180;
  return {
    ...element,
    x: width - element.x - element.width * Math.cos(radians),
    y: element.y + element.width * Math.sin(radians),
    rotation: -element.rotation || 0,
  };
}

function mirrorLeaf(leaf: LeafElement, width: number): LeafElement {
  const mirrored = mirrorPlacement(leaf, width);
  switch (mirrored.type) {
    case "text":
      return {
        ...mirrored,
        align: mirrored.align === "left" ? "right" : mirrored.align === "right" ? "left" : "center",
        ...(mirrored.shadow
          ? { shadow: { ...mirrored.shadow, offsetX: -mirrored.shadow.offsetX || 0 } }
          : {}),
      };
    case "shape":
      return mirrored.gradient
        ? { ...mirrored, gradient: { ...mirrored.gradient, angle: mirrorGradientAngle(mirrored.gradient.angle) } }
        : mirrored;
    default:
      return mirrored;
  }
}

/** Bake one physical horizontal direction change without reflecting media pixels. */
export function mirrorElement(element: Element, width: number): Element {
  if (element.type !== "group") return mirrorLeaf(element, width);
  return {
    ...mirrorPlacement(element, width),
    children: element.children.map((child) => mirrorLeaf(child, element.width)),
  };
}
