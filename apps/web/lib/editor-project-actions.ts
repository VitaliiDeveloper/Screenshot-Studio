// SPDX-License-Identifier: Apache-2.0
import {
  cloneLocaleSet,
  ensureStoreOutputFamily,
  ensureStoreTargetVariant,
  getLayout,
  isPrimaryScreen,
  removeLocaleSet,
  removeStoreTargetVariant,
  sameOutputFamily,
  setOutputFamilyScreenSetMode as setOutputFamilyScreenSetModeCore,
  setLocaleDirection,
  type LayoutDirection,
  type Project,
  type ScreenSetMode,
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
  const layout = getLayout(project, layoutId);
  const variant = layout.screens.find((screen) =>
    (screen.variantOf === rootScreenId || screen.id === rootScreenId)
    && screen.storeTargetId === storeTargetId,
  );
  if (!variant) return { project, activeScreenId, selectedItems };
  const familyPrimary = layout.screens.find((screen) =>
    sameOutputFamily(screen, variant) && isPrimaryScreen(screen)
  );
  const nextProject = removeStoreTargetVariant(project, layoutId, rootScreenId, storeTargetId);
  const nextLayout = getLayout(nextProject, layoutId);
  const remainingIds = new Set(nextLayout.screens.map((screen) => screen.id));
  const previousActive = getLayout(project, layoutId).screens.find((screen) =>
    screen.id === activeScreenId
  );
  const fallbackRootId = previousActive?.variantOf ?? familyPrimary?.id ?? rootScreenId;
  return {
    project: nextProject,
    activeScreenId: activeScreenId && remainingIds.has(activeScreenId)
      ? activeScreenId
      : remainingIds.has(fallbackRootId)
        ? fallbackRootId
        : nextLayout.screens[0]?.id ?? null,
    selectedItems: selectedItems.filter((item) => remainingIds.has(item.screenId)),
  };
}

export function changeOutputFamilyScreenSetMode(
  project: Project,
  layoutId: string,
  activeScreenId: string,
  mode: ScreenSetMode,
): ProjectMutationResult {
  return {
    project: setOutputFamilyScreenSetModeCore(project, layoutId, activeScreenId, mode),
    activeScreenId,
    selectedItems: [],
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
