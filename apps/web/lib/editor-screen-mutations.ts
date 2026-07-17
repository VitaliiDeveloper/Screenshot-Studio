// SPDX-License-Identifier: Apache-2.0
import { produce } from "immer";
import {
  cloneScreenWithFreshIds,
  getLayout,
  removeScreenFromProject,
  replaceLayout,
  resizeStoreOutputArtboards,
  sameScreenGroup,
  type Background,
  type Element,
  type Project,
} from "@screenshot-studio/core/model";
import { primarySelection, reconcileSelection, type SelectionRef } from "./editor-selection.js";

export interface ProjectMutationResult {
  project: Project;
  activeScreenId?: string | null;
  selectedItems?: SelectionRef[];
}

function moveInPlace<T>(items: T[], from: number, to: number): void {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
  const [item] = items.splice(from, 1);
  items.splice(to, 0, item as T);
}

export function reorderProjectScreens(
  project: Project,
  layoutId: string,
  fromId: string,
  toId: string,
): Project {
  if (fromId === toId) return project;
  const layout = getLayout(project, layoutId);
  const fromScreen = layout.screens.find((screen) => screen.id === fromId);
  const toScreen = layout.screens.find((screen) => screen.id === toId);
  if (!fromScreen || !toScreen) return project;
  const inScope = layout.mode === "connected"
    ? (screen: typeof fromScreen) => sameScreenGroup(screen, fromScreen)
    : (screen: typeof fromScreen) => screen.locale === fromScreen.locale
      && screen.platform === fromScreen.platform
      && screen.device === fromScreen.device
      && screen.storeTargetId === fromScreen.storeTargetId;
  if (!inScope(toScreen)) return project;
  return produce(project, (draft) => {
    const screensDraft = draft.layouts.find((candidate) => candidate.id === layoutId)!.screens;
    const indices = screensDraft
      .map((screen, index) => inScope(screen) ? index : -1)
      .filter((index) => index >= 0);
    const screens = indices.map((index) => screensDraft[index]!);
    const from = screens.findIndex((screen) => screen.id === fromId);
    const to = screens.findIndex((screen) => screen.id === toId);
    moveInPlace(screens, from, to);
    indices.forEach((index, position) => { screensDraft[index] = screens[position]!; });
  });
}

function sourceScreen(project: Project, layoutId: string, activeScreenId: string | null) {
  const layout = getLayout(project, layoutId);
  const active = layout.screens.find((screen) => screen.id === activeScreenId)
    ?? layout.screens[0];
  if (!active) return null;
  return active.variantOf
    ? layout.screens.find((screen) => screen.id === active.variantOf) ?? active
    : active;
}

export function appendClonedScreen(
  project: Project,
  layoutId: string,
  activeScreenId: string | null,
): ProjectMutationResult {
  const source = sourceScreen(project, layoutId, activeScreenId);
  if (!source) return { project };
  const cloned = cloneScreenWithFreshIds(source);
  const { variantOf: _variantOf, storeTargetId: _storeTargetId, ...copy } = cloned;
  const layout = getLayout(project, layoutId);
  return {
    project: replaceLayout(project, {
      ...layout,
      screens: [...layout.screens, copy as typeof cloned],
    }),
    activeScreenId: copy.id,
    selectedItems: [],
  };
}

export function appendBlankScreen(
  project: Project,
  layoutId: string,
  activeScreenId: string | null,
): ProjectMutationResult {
  const source = sourceScreen(project, layoutId, activeScreenId);
  if (!source) return { project };
  const cloned = structuredClone(source);
  const { variantOf: _variantOf, storeTargetId: _storeTargetId, ...added } = {
    ...cloned,
    id: crypto.randomUUID(),
    name: "Untitled",
    elements: [],
  };
  const layout = getLayout(project, layoutId);
  return {
    project: replaceLayout(project, { ...layout, screens: [...layout.screens, added] }),
    activeScreenId: added.id,
    selectedItems: [],
  };
}

export function removeProjectScreen(
  project: Project,
  layoutId: string,
  id: string,
  activeScreenId: string | null,
  selectedItems: SelectionRef[],
): ProjectMutationResult {
  const layout = getLayout(project, layoutId);
  const index = layout.screens.findIndex((screen) => screen.id === id);
  if (index === -1) return { project, activeScreenId, selectedItems };
  const removed = layout.screens[index]!;
  const localeRootScreens = layout.screens.filter((screen) =>
    screen.variantOf === undefined && screen.locale === removed.locale,
  );
  if (removed.variantOf === undefined && localeRootScreens.length <= 1) {
    return { project, activeScreenId, selectedItems };
  }
  const removedIds = new Set([id, ...layout.screens
    .filter((screen) => screen.variantOf === id)
    .map((screen) => screen.id)]);
  const nextProject = removeScreenFromProject(project, layoutId, id, { cascadeVariants: true });
  const nextLayout = getLayout(nextProject, layoutId);
  const wasActive = activeScreenId ? removedIds.has(activeScreenId) : false;
  const nextActiveScreenId = wasActive
    ? (nextLayout.screens.find((screen) =>
      screen.locale === removed.locale && screen.storeTargetId === removed.storeTargetId,
    ) ?? nextLayout.screens.find((screen) => screen.locale === removed.locale)
      ?? nextLayout.screens[Math.min(index, nextLayout.screens.length - 1)])!.id
    : activeScreenId;
  const remainingSelection = selectedItems.filter((item) => !removedIds.has(item.screenId));
  return {
    project: nextProject,
    activeScreenId: nextActiveScreenId,
    selectedItems: reconcileSelection(nextLayout, nextActiveScreenId, remainingSelection),
  };
}

export function reorderScreenElements(
  project: Project,
  layoutId: string,
  activeScreenId: string,
  from: number,
  to: number,
): Project {
  return produce(project, (draft) => {
    const screen = draft.layouts.find((layout) => layout.id === layoutId)?.screens
      .find((candidate) => candidate.id === activeScreenId);
    if (screen) moveInPlace(screen.elements, from, to);
  });
}

export function removeScreenElement(
  project: Project,
  layoutId: string,
  activeScreenId: string | null,
  selectedItems: SelectionRef[],
  id: string,
  screenId?: string,
): ProjectMutationResult {
  const primary = primarySelection(selectedItems);
  const ownerScreenId = screenId
    ?? (primary?.elementId === id ? primary.screenId : null)
    ?? activeScreenId;
  if (!ownerScreenId) return { project, selectedItems };
  const nextProject = produce(project, (draft) => {
    const screen = draft.layouts.find((layout) => layout.id === layoutId)?.screens
      .find((candidate) => candidate.id === ownerScreenId);
    if (!screen) return;
    for (let elementIndex = screen.elements.length - 1; elementIndex >= 0; elementIndex -= 1) {
      const element = screen.elements[elementIndex]!;
      if (element.id === id) {
        screen.elements.splice(elementIndex, 1);
        continue;
      }
      if (element.type !== "group") continue;
      const childIndex = element.children.findIndex((child) => child.id === id);
      if (childIndex >= 0) element.children.splice(childIndex, 1);
      if (element.children.length === 0) screen.elements.splice(elementIndex, 1);
    }
  });
  return {
    project: nextProject,
    selectedItems: selectedItems.filter(
      (item) => item.screenId !== ownerScreenId || item.elementId !== id,
    ),
  };
}

export function appendScreenElement(
  project: Project,
  layoutId: string,
  activeScreenId: string,
  element: Element,
): ProjectMutationResult {
  return {
    project: produce(project, (draft) => {
      const screen = draft.layouts.find((layout) => layout.id === layoutId)?.screens
        .find((candidate) => candidate.id === activeScreenId);
      if (screen) screen.elements.push(element);
    }),
    selectedItems: [{ screenId: activeScreenId, elementId: element.id }],
  };
}

export function setScreenBackground(
  project: Project,
  layoutId: string,
  activeScreenId: string,
  background: Background,
): Project {
  return produce(project, (draft) => {
    const screen = draft.layouts.find((layout) => layout.id === layoutId)?.screens
      .find((candidate) => candidate.id === activeScreenId);
    if (screen) screen.background = background;
  });
}

export function resizeProjectArtboards(
  project: Project,
  layoutId: string,
  activeScreenId: string,
  size: { width: number; height: number },
): Project {
  const active = getLayout(project, layoutId).screens.find((screen) => screen.id === activeScreenId);
  if (!active) return project;
  return resizeStoreOutputArtboards(project, layoutId, active.id, size);
}
