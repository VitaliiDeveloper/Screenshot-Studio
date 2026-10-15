// SPDX-License-Identifier: Apache-2.0
import { findElementLocation, getLayout, getScreen, type Project } from "@screenshot-studio/core/model";
import {
  primarySelection,
  selectionBounds,
  type SelectionRef,
} from "@web/lib/editor-selection";

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
  const primaryLocation = selectedItems.length === 1 && primary
    ? findElementLocation(screen, primary.elementId)
    : null;
  const element = primaryLocation?.element;
  const effectiveLocked = Boolean(
    primaryLocation && (primaryLocation.element.locked || primaryLocation.parent?.locked),
  );
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
  const canDuplicate = selectedItems.length > 0
    && selectedLocations.every(({ location }) => location && !location.parent);
  // Arrange measures top-level bounds and never moves locked layers.
  const canAlign = selectedItems.length >= 2 && canDuplicate && !everyLocked;
  const canDistribute = canAlign && selectedItems.length >= 3;
  // Batch opacity skips locked layers, so the slider mirrors the last layer it can change.
  const opacitySource = [...selectedLocations].reverse().find(({ location }) => (
    location && !location.element.locked && !location.parent?.locked
  )) ?? selectedLocations.at(-1);
  const sharedOpacity = opacitySource?.location?.element.opacity ?? 1;

  return {
    screen,
    element,
    effectiveLocked,
    aggregate,
    selectedElements,
    everyLocked,
    everyHidden,
    canGroup,
    canUngroup,
    canDuplicate,
    canAlign,
    canDistribute,
    sharedOpacity,
  };
}
