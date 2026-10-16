// SPDX-License-Identifier: Apache-2.0
import type { Element } from "@screenshot-studio/core/model";
import type { SelectionRef } from "@web/lib/editor-selection";
import { elementLabel, elementTypeLabel, selectionTypeSummary } from "@web/lib/panel-helpers";

export type InspectorTab = "layer" | "screen";

/** A tab the user picked, remembered only for the selection it was picked with. */
export type InspectorTabChoice = { tab: InspectorTab; selectionKey: string };

/** Stable identity of the current selection; empty when nothing is selected. */
export function inspectorSelectionKey(items: readonly SelectionRef[]): string {
  return items.map((item) => `${item.screenId}/${item.elementId}`).join("|");
}

/**
 * Selecting a layer opens Layer and clearing the selection opens Screen. A manual choice holds
 * until the selection changes.
 */
export function resolveInspectorTab(selectionKey: string, choice: InspectorTabChoice | null): InspectorTab {
  if (choice && choice.selectionKey === selectionKey) return choice.tab;
  return selectionKey === "" ? "screen" : "layer";
}

/**
 * Inspector context line: a title and an optional detail; the selected tab already names the scope.
 * The Screen tab always names the active screen: its background, artboard, and output edits target
 * that screen even when a connected-layout selection belongs to a neighbouring screen.
 */
export function inspectorHeading({
  tab,
  activeScreenName,
  selectedElements,
  selectionScreenName,
}: {
  tab: InspectorTab;
  activeScreenName: string;
  selectedElements: readonly Pick<Element, "type" | "name">[];
  selectionScreenName: string;
}): [title: string, subtitle: string] {
  if (tab === "screen") {
    return [activeScreenName, selectedElements.length === 0 ? "nothing selected" : ""];
  }
  if (selectedElements.length > 1) {
    return [`${selectedElements.length} layers selected`, selectionTypeSummary(selectedElements)];
  }
  const [element] = selectedElements;
  if (element) return [elementLabel(element), `${elementTypeLabel(element.type).toLowerCase()} layer · ${selectionScreenName}`];
  return [activeScreenName, "nothing selected"];
}
