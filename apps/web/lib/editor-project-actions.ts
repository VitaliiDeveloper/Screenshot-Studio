// SPDX-License-Identifier: Apache-2.0
import {
  cloneLocaleSet,
  ensureStoreOutputFamily,
  ensureStoreTargetVariant,
  removeLocaleSet,
  removeStoreTargetVariant,
  setCanvasMode,
  setLocaleDirection,
  type CanvasMode,
  type LayoutDirection,
  type Project,
} from "@screenshot-studio/core/model";
import type { StoreSize } from "@screenshot-studio/core/export";
import { reconcileSelection, type SelectionRef } from "./editor-selection.js";
import type { ProjectMutationResult } from "./editor-screen-mutations.js";

export function changeCanvasMode(
  project: Project,
  activeScreenId: string | null,
  selectedItems: SelectionRef[],
  mode: CanvasMode,
): ProjectMutationResult {
  const nextProject = setCanvasMode(project, mode);
  return {
    project: nextProject,
    selectedItems: reconcileSelection(nextProject, activeScreenId, selectedItems),
  };
}

export function createStoreOutputFamily(
  project: Project,
  activeScreenId: string,
  platform: string,
  device: string,
  leadTarget: StoreSize,
): ProjectMutationResult {
  const result = ensureStoreOutputFamily(project, activeScreenId, platform, device, leadTarget);
  return { project: result.project, activeScreenId: result.firstScreen.id, selectedItems: [] };
}

export function createStoreTargetVariant(
  project: Project,
  activeScreenId: string,
  target: StoreSize,
): ProjectMutationResult {
  const result = ensureStoreTargetVariant(project, activeScreenId, target);
  return { project: result.project, activeScreenId: result.variant.id, selectedItems: [] };
}

export function deleteStoreTargetVariant(
  project: Project,
  activeScreenId: string | null,
  selectedItems: SelectionRef[],
  rootScreenId: string,
  storeTargetId: string,
): ProjectMutationResult {
  const variant = project.screens.find((screen) =>
    screen.variantOf === rootScreenId && screen.storeTargetId === storeTargetId,
  );
  if (!variant) return { project, activeScreenId, selectedItems };
  return {
    project: removeStoreTargetVariant(project, rootScreenId, storeTargetId),
    activeScreenId: activeScreenId === variant.id ? rootScreenId : activeScreenId,
    selectedItems: selectedItems.filter((item) => item.screenId !== variant.id),
  };
}

export function cloneProjectLocale(
  project: Project,
  sourceLocale: string,
  targetLocale: string,
  direction: LayoutDirection,
): ProjectMutationResult {
  const nextProject = cloneLocaleSet(project, sourceLocale, targetLocale, direction);
  return {
    project: nextProject,
    activeScreenId: nextProject.screens.find((screen) => screen.locale === targetLocale)!.id,
    selectedItems: [],
  };
}

export function changeProjectLocaleDirection(
  project: Project,
  locale: string,
  direction: LayoutDirection,
): Project {
  return setLocaleDirection(project, locale, direction);
}

export function deleteProjectLocale(
  project: Project,
  activeScreenId: string | null,
  locale: string,
): ProjectMutationResult {
  const activeScreen = project.screens.find((screen) => screen.id === activeScreenId);
  const nextProject = removeLocaleSet(project, locale);
  if (activeScreen?.locale !== locale) return { project: nextProject };
  return {
    project: nextProject,
    activeScreenId: nextProject.screens[0]!.id,
    selectedItems: [],
  };
}
