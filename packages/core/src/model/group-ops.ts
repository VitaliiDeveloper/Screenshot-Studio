// SPDX-License-Identifier: Apache-2.0
import { rotatedElementBounds } from "./connected-canvas.js";
import { scaleLeafElement } from "./element-scale.js";
import { cloneElementWithFreshIds } from "./element-tree.js";
import { Screen as ScreenSchema, type Element, type GroupElement, type LeafElement, type Screen } from "./schema.js";

export interface ElementLocation {
  element: Element | LeafElement;
  parent: GroupElement | null;
}

export function findElementLocation(screen: Screen, elementId: string): ElementLocation | null {
  for (const element of screen.elements) {
    if (element.id === elementId) return { element, parent: null };
    if (element.type === "group") {
      const child = element.children.find((candidate) => candidate.id === elementId);
      if (child) return { element: child, parent: element };
    }
  }
  return null;
}

export function groupElements(
  screen: Screen,
  elementIds: readonly string[],
  createId: () => string = () => crypto.randomUUID(),
): { screen: Screen; group: GroupElement } {
  const ids = new Set(elementIds);
  if (ids.size < 2) throw new Error("Select at least two elements to group");
  const selected = screen.elements.filter((element) => ids.has(element.id));
  if (selected.length !== ids.size) throw new Error("Grouping requires top-level elements from one owner screen");
  if (selected.some((element) => element.type === "group")) {
    throw new Error("Nested groups are not supported; ungroup the existing group first");
  }
  const leaves = selected as LeafElement[];
  const bounds = leaves.map(rotatedElementBounds);
  const minX = Math.min(...bounds.map((bound) => bound.minX));
  const minY = Math.min(...bounds.map((bound) => bound.minY));
  const maxX = Math.max(...bounds.map((bound) => bound.maxX));
  const maxY = Math.max(...bounds.map((bound) => bound.maxY));
  const group: GroupElement = {
    id: createId(),
    type: "group",
    name: "Group",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    children: leaves.map((leaf) => ({ ...leaf, x: leaf.x - minX, y: leaf.y - minY })),
  };
  const highestIndex = Math.max(...screen.elements.map((element, index) => ids.has(element.id) ? index : -1));
  const remaining = screen.elements.filter((element) => !ids.has(element.id));
  const insertionIndex = screen.elements
    .slice(0, highestIndex + 1)
    .filter((element) => !ids.has(element.id)).length;
  remaining.splice(insertionIndex, 0, group);
  return { screen: ScreenSchema.parse({ ...screen, elements: remaining }), group };
}

function childFromGroup(group: GroupElement, child: LeafElement): LeafElement {
  const radians = group.rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    ...child,
    x: group.x + child.x * cos - child.y * sin,
    y: group.y + child.x * sin + child.y * cos,
    rotation: group.rotation + child.rotation,
    opacity: group.opacity * child.opacity,
    locked: group.locked || child.locked,
    visible: group.visible && child.visible,
  };
}

export function ungroupElement(screen: Screen, groupId: string): { screen: Screen; children: LeafElement[] } {
  const index = screen.elements.findIndex((element) => element.id === groupId);
  const element = screen.elements[index];
  if (!element || element.type !== "group") throw new Error(`Element "${groupId}" is not a group`);
  const children = element.children.map((child) => childFromGroup(element, child));
  const elements = [...screen.elements];
  elements.splice(index, 1, ...children);
  return { screen: ScreenSchema.parse({ ...screen, elements }), children };
}

export function resizeGroupUniform(
  group: GroupElement,
  width: number,
  height: number,
): GroupElement {
  if (width <= 0 || height <= 0) throw new Error("Group dimensions must be positive");
  const scaleX = width / group.width;
  const scaleY = height / group.height;
  if (Math.abs(scaleX - scaleY) > 1e-4) {
    throw new Error("Groups can only be resized uniformly");
  }
  const scale = (scaleX + scaleY) / 2;
  return {
    ...group,
    width: group.width * scale,
    height: group.height * scale,
    children: group.children.map((child) => scaleLeafElement(child, scale)),
  };
}

export function duplicateElement(
  element: Element,
  createId: () => string = () => crypto.randomUUID(),
  offset = 20,
): Element {
  const copy = cloneElementWithFreshIds(element, createId);
  return { ...copy, x: copy.x + offset, y: copy.y + offset, name: `${copy.name ?? copy.type} copy` };
}
