// SPDX-License-Identifier: Apache-2.0
import {
  cloneLocaleSet,
  ensureStoreOutputFamily,
  ensureStoreTargetVariant,
  getLayout,
  removeLocaleSet,
  removeStoreTargetVariant,
  setLocaleDirection,
  type LayoutDirection,
  type Project,
} from "@screenshot-studio/core/model";
import type { StoreSize } from "@screenshot-studio/core/export";
import type { SelectionRef } from "./editor-selection.js";
import type { ProjectMutationResult } from "./editor-screen-mutations.js";

export function createStoreOutputFamily(
  project: Project,
  layoutId: string,
  activeScreenId: string,
  platform: string,
  device: string,
  leadTarget: StoreSize,
): ProjectMutationResult {
  const result = ensureStoreOutputFamily(project, layoutId, activeScreenId, platform, device, leadTarget);
  return { project: result.project, activeScreenId: result.firstScreen.id, selectedItems: [] };
}

export function createStoreTargetVariant(
  project: Project,
  layoutId: string,
  activeScreenId: string,
  target: StoreSize,
): ProjectMutationResult {
  const result = ensureStoreTargetVariant(project, layoutId, activeScreenId, target);
  return { project: result.project, activeScreenId, selectedItems: [] };
}

export function deleteStoreTargetVariant(
  project: Project,
  layoutId: string,
  activeScreenId: string | null,
  selectedItems: SelectionRef[],
  rootScreenId: string,
  storeTargetId: string,
): ProjectMutationResult {
  const variant = getLayout(project, layoutId).screens.find((screen) =>
    screen.variantOf === rootScreenId && screen.storeTargetId === storeTargetId,
  );
  if (!variant) return { project, activeScreenId, selectedItems };
  return {
    project: removeStoreTargetVariant(project, layoutId, rootScreenId, storeTargetId),
    activeScreenId: activeScreenId === variant.id ? rootScreenId : activeScreenId,
    selectedItems: selectedItems.filter((item) => item.screenId !== variant.id),
  };
}

export function cloneProjectLocale(
  project: Project,
  layoutId: string,
  sourceLocale: string,
  targetLocale: string,
  direction: LayoutDirection,
): ProjectMutationResult {
  const nextProject = cloneLocaleSet(project, layoutId, sourceLocale, targetLocale, direction);
  return {
    project: nextProject,
    activeScreenId: getLayout(nextProject, layoutId).screens
      .find((screen) => screen.locale === targetLocale)!.id,
    selectedItems: [],
  };
}

export function changeProjectLocaleDirection(
  project: Project,
  layoutId: string,
  locale: string,
  direction: LayoutDirection,
): Project {
  return setLocaleDirection(project, layoutId, locale, direction);
}

export function deleteProjectLocale(
  project: Project,
  layoutId: string,
  activeScreenId: string | null,
  locale: string,
): ProjectMutationResult {
  const activeScreen = getLayout(project, layoutId).screens
    .find((screen) => screen.id === activeScreenId);
  const nextProject = removeLocaleSet(project, layoutId, locale);
  if (activeScreen?.locale !== locale) return { project: nextProject };
  return {
    project: nextProject,
    activeScreenId: getLayout(nextProject, layoutId).screens[0]!.id,
    selectedItems: [],
  };
}
