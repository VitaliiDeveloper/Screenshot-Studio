// SPDX-License-Identifier: Apache-2.0
import type { Element, LeafElement } from "./schema.js";

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

function swapTextAlignment(leaf: LeafElement): LeafElement {
  if (leaf.type !== "text") return leaf;
  return {
    ...leaf,
    align: leaf.align === "left" ? "right" : leaf.align === "right" ? "left" : "center",
  };
}

function mirrorLeaf(leaf: LeafElement, width: number): LeafElement {
  return swapTextAlignment({ ...leaf, x: width - leaf.x - leaf.width });
}

/** Bake one physical horizontal direction change without reflecting media pixels. */
export function mirrorElement(element: Element, width: number): Element {
  const mirroredX = width - element.x - element.width;
  if (element.type !== "group") return mirrorLeaf(element, width);
  return {
    ...element,
    x: mirroredX,
    children: element.children.map((child) => mirrorLeaf(child, element.width)),
  };
}
