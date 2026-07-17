// SPDX-License-Identifier: Apache-2.0
import { findElementLocation, getLayout, getScreen, type Project } from "@screenshot-studio/core/model";
import {
  primarySelection,
  selectionBounds,
  type SelectionRef,
} from "../../lib/editor-selection";

export function deriveInspectorSelection(
  project: Project,
  layoutId: string,
  activeScreenId: string,
  selectedItems: readonly SelectionRef[],
) {
  const primary = primarySelection(selectedItems);
  const screen = getScreen(
    project,
    layoutId,
    selectedItems.length === 1 && primary ? primary.screenId : activeScreenId,
  );
  const element = selectedItems.length === 1 && primary
    ? findElementLocation(screen, primary.elementId)?.element
    : undefined;
  const aggregate = selectedItems.length > 1
    ? selectionBounds(getLayout(project, layoutId), activeScreenId, selectedItems)
    : null;
  const selectedLocations = selectedItems.map((selection) => {
    const owner = getLayout(project, layoutId).screens
      .find((candidate) => candidate.id === selection.screenId);
    return { selection, location: owner ? findElementLocation(owner, selection.elementId) : null };
  });
  const selectedElements = selectedLocations.flatMap(({ location }) => (
    location ? [location.element] : []
  ));
  const everyLocked = selectedElements.length > 0
    && selectedElements.every((candidate) => candidate.locked);
  const everyHidden = selectedElements.length > 0
    && selectedElements.every((candidate) => !candidate.visible);
  const canGroup = selectedItems.length >= 2
    && new Set(selectedItems.map((item) => item.screenId)).size === 1
    && selectedLocations.every(({ location }) => (
      location && !location.parent && location.element.type !== "group"
    ));
  const canUngroup = selectedItems.length > 0
    && selectedLocations.every(({ location }) => (
      location && !location.parent && location.element.type === "group"
    ));

  return { screen, element, aggregate, everyLocked, everyHidden, canGroup, canUngroup };
}
