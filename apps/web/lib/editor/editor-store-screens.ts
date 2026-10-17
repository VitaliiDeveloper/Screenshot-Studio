// SPDX-License-Identifier: Apache-2.0
import type { Background, Element, LayoutDirection } from "@screenshot-studio/core/model";
import { recordProjectChange } from "./editor-history.js";
import {
  appendBlankScreen,
  appendClonedScreen,
  appendScreenElement,
  removeProjectScreen,
  removeScreenElement,
  reorderProjectScreens,
  reorderScreenElements,
  resizeProjectArtboards,
  setScreenBackground,
} from "./editor-screen-mutations.js";
import {
  changeProjectLocaleDirection,
  cloneProjectLocale,
  createScreenFromLocale,
  deleteProjectLocale,
} from "./editor-project-actions.js";
import { selectEditorLayout } from "./editor-store-layouts.js";
import type { EditorSet } from "./editor-store.js";

/** Screens and locales of the active layout, and the content of the active screen. */
export interface EditorScreenActions {
  selectScreen: (id: string) => void;
  selectLocale: (locale: string) => void;
  reorderScreens: (fromId: string, toId: string) => void;
  addScreen: () => void;
  addBlankScreen: () => void;
  removeScreen: (id: string) => void;
  addLocale: (sourceLocale: string, targetLocale: string, direction: LayoutDirection) => void;
  /** Copy a screen into another locale of the active layout (the missing-locale Issues fix). */
  createScreenFromLocale: (sourceScreenId: string, targetLocale: string) => void;
  setLocaleDirection: (locale: string, direction: LayoutDirection) => void;
  removeLocale: (locale: string) => void;
  reorderElements: (from: number, to: number) => void;
  removeElement: (id: string, screenId?: string) => void;
  addElement: (element: Element) => void;
  setBackground: (background: Background) => void;
  resizeArtboard: (size: { width: number; height: number }) => void;
}

export function createEditorScreenActions(set: EditorSet): EditorScreenActions {
  return {
    selectScreen: (id) => set({
      activeScreenId: id,
      selectedItems: [],
      historyGroupKey: null,
    }),
    selectLocale: (locale) =>
      set((state) => {
        const activeScreenId = selectEditorLayout(state)?.screens
          .find((screen) => screen.locale === locale)?.id;
        return activeScreenId
          ? { activeScreenId, selectedItems: [], historyGroupKey: null }
          : state;
      }),
    reorderScreens: (fromId, toId) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId) return state;
        return recordProjectChange(
          state,
          reorderProjectScreens(state.project, state.activeLayoutId, fromId, toId),
        );
      }),
    addScreen: () =>
      set((state) => {
        if (!state.project || !state.activeLayoutId) return state;
        const result = appendClonedScreen(state.project, state.activeLayoutId, state.activeScreenId);
        return recordProjectChange(state, result.project, null, result);
      }),
    addBlankScreen: () =>
      set((state) => {
        if (!state.project || !state.activeLayoutId) return state;
        const result = appendBlankScreen(state.project, state.activeLayoutId, state.activeScreenId);
        return recordProjectChange(state, result.project, null, result);
      }),
    removeScreen: (id) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId) return state;
        const result = removeProjectScreen(
          state.project,
          state.activeLayoutId,
          id,
          state.activeScreenId,
          state.selectedItems,
        );
        return recordProjectChange(state, result.project, null, result);
      }),
    addLocale: (sourceLocale, targetLocale, direction) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId) return state;
        const result = cloneProjectLocale(
          state.project,
          state.activeLayoutId,
          sourceLocale,
          targetLocale,
          direction,
        );
        return recordProjectChange(state, result.project, null, result);
      }),
    createScreenFromLocale: (sourceScreenId, targetLocale) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId) return state;
        const result = createScreenFromLocale(state.project, state.activeLayoutId, sourceScreenId, targetLocale);
        return recordProjectChange(state, result.project, null, result);
      }),
    setLocaleDirection: (locale, direction) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId) return state;
        return recordProjectChange(
          state,
          changeProjectLocaleDirection(state.project, state.activeLayoutId, locale, direction),
        );
      }),
    removeLocale: (locale) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId) return state;
        const result = deleteProjectLocale(
          state.project,
          state.activeLayoutId,
          state.activeScreenId,
          locale,
        );
        return recordProjectChange(state, result.project, null, result);
      }),
    reorderElements: (from, to) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId || !state.activeScreenId) return state;
        return recordProjectChange(
          state,
          reorderScreenElements(state.project, state.activeLayoutId, state.activeScreenId, from, to),
        );
      }),
    removeElement: (id, screenId) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId) return state;
        const result = removeScreenElement(
          state.project,
          state.activeLayoutId,
          state.activeScreenId,
          state.selectedItems,
          id,
          screenId,
        );
        return recordProjectChange(state, result.project, null, result);
      }),
    addElement: (element) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId || !state.activeScreenId) return state;
        const result = appendScreenElement(
          state.project,
          state.activeLayoutId,
          state.activeScreenId,
          element,
        );
        return recordProjectChange(state, result.project, null, result);
      }),
    setBackground: (background) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId || !state.activeScreenId) return state;
        return recordProjectChange(
          state,
          setScreenBackground(state.project, state.activeLayoutId, state.activeScreenId, background),
          `background:${state.activeScreenId}`,
        );
      }),
    resizeArtboard: (size) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId || !state.activeScreenId) return state;
        return recordProjectChange(
          state,
          resizeProjectArtboards(state.project, state.activeLayoutId, state.activeScreenId, size),
        );
      }),
  };
}
