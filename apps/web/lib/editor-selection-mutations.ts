// SPDX-License-Identifier: Apache-2.0
import type {
  Element,
  GroupElement,
  Project,
} from "@screenshot-studio/core/model";
import type { SelectionRef } from "./editor-selection.js";

export type SelectedElementIndex = Map<string, Set<string>>;

export interface SelectedElementLocation {
  screen: Project["screens"][number];
  element: Element;
  parent: GroupElement | null;
  elementIndex: number;
  childIndex: number | null;
}

export function createSelectedElementIndex(
  selections: readonly SelectionRef[],
): SelectedElementIndex {
  const index: SelectedElementIndex = new Map();
  for (const selection of selections) {
    const elementIds = index.get(selection.screenId) ?? new Set<string>();
    elementIds.add(selection.elementId);
    index.set(selection.screenId, elementIds);
  }
  return index;
}

/**
 * Visit selected elements in reverse layer order so callers may safely remove them in place.
 * A selected group owns the mutation; its selected children are not visited separately.
 */
export function forEachSelectedElement(
  project: Project,
  selections: readonly SelectionRef[],
  visit: (location: SelectedElementLocation) => void,
): void {
  const selectedByScreen = createSelectedElementIndex(selections);
  for (const screen of project.screens) {
    const selectedIds = selectedByScreen.get(screen.id);
    if (!selectedIds) continue;
    for (let elementIndex = screen.elements.length - 1; elementIndex >= 0; elementIndex -= 1) {
      const element = screen.elements[elementIndex]!;
      if (selectedIds.has(element.id)) {
        visit({ screen, element, parent: null, elementIndex, childIndex: null });
        continue;
      }
      if (element.type !== "group") continue;
      for (let childIndex = element.children.length - 1; childIndex >= 0; childIndex -= 1) {
        const child = element.children[childIndex]!;
        if (selectedIds.has(child.id)) {
          visit({ screen, element: child, parent: element, elementIndex, childIndex });
        }
      }
    }
  }
}
