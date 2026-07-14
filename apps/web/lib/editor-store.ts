// SPDX-License-Identifier: Apache-2.0
import { createStore } from "zustand/vanilla";
import { produce } from "immer";
import {
  duplicateElement as duplicateElementCore,
  findElementLocation,
  groupElements as groupElementsCore,
  ungroupElement as ungroupElementCore,
  type CanvasMode,
  type Background,
  type Project,
  type Element,
  type FontAsset,
  type LayoutDirection,
} from "@screenshot-studio/core/model";
import type { StoreSize } from "@screenshot-studio/core/export";
import {
  primarySelection,
  reconcileSelection,
  toggleSelection,
  type SelectionRef,
} from "./editor-selection.js";
import {
  applyMatchingElementPatch,
  type ElementPatchRequest,
} from "./editor-element-patch.js";
import { forEachSelectedElement } from "./editor-selection-mutations.js";
import {
  recordProjectChange,
  redoProjectChange,
  selectionForProject,
  undoProjectChange,
} from "./editor-history.js";
import {
  appendBlankScreen,
  appendClonedScreen,
  appendScreenElement,
  removeProjectScreen,
  removeScreenElement,
  reorderProjectScreens,
  reorderScreenElements,
  replaceProjectFonts,
  resizeProjectArtboards,
  setScreenBackground,
} from "./editor-screen-mutations.js";
import {
  changeCanvasMode,
  changeProjectLocaleDirection,
  cloneProjectLocale,
  createStoreOutputFamily,
  createStoreTargetVariant,
  deleteProjectLocale,
  deleteStoreTargetVariant,
} from "./editor-project-actions.js";

export {
  applyElementPatch,
  type CommonElementPatch,
  type ElementPatch,
  type ElementPatchFor,
  type ElementPatchRequest,
} from "./editor-element-patch.js";

export type PatchElementRequest<T extends Element["type"] = Element["type"]> =
  ElementPatchRequest<T> & { id: string; screenId?: string };

/**
 * Editor state as a framework-agnostic Zustand vanilla store, bound to React via `useStore` in
 * components. Every mutation goes through Immer, so each change is a discrete immutable patch —
 * the day-0 requirement (roadmap.md §1) now used by bounded undo/redo history.
 * The store is the only writer of project state; the canvas dispatches actions, never mutates.
 */

export interface EditorState {
  project: Project | null;
  activeScreenId: string | null;
  selectedItems: SelectionRef[];
  historyPast: Project[];
  historyFuture: Project[];
  historyGroupKey: string | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
  load: (project: Project) => void;
  setSaveState: (status: EditorState["saveStatus"], error?: string | null) => void;
  select: (id: string | null, screenId?: string, mode?: "replace" | "toggle") => void;
  setSelection: (items: SelectionRef[]) => void;
  patchElement: <T extends Element["type"]>(request: PatchElementRequest<T>) => void;
  moveSelected: (delta: { x: number; y: number }) => void;
  removeSelected: () => void;
  setSelectedLocked: (locked: boolean) => void;
  setSelectedVisible: (visible: boolean) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  duplicateSelected: () => void;
  selectScreen: (id: string) => void;
  selectLocale: (locale: string) => void;
  reorderScreens: (fromId: string, toId: string) => void;
  setCanvasMode: (mode: CanvasMode) => void;
  addScreen: () => void;
  addBlankScreen: () => void;
  removeScreen: (id: string) => void;
  ensureStoreOutputFamily: (platform: string, device: string, leadTarget: StoreSize) => void;
  ensureStoreTargetVariant: (target: StoreSize) => void;
  removeStoreTargetVariant: (rootScreenId: string, storeTargetId: string) => void;
  addLocale: (sourceLocale: string, targetLocale: string, direction: LayoutDirection) => void;
  setLocaleDirection: (locale: string, direction: LayoutDirection) => void;
  removeLocale: (locale: string) => void;
  reorderElements: (from: number, to: number) => void;
  removeElement: (id: string, screenId?: string) => void;
  addElement: (element: Element) => void;
  setBackground: (background: Background) => void;
  resizeArtboard: (size: { width: number; height: number }) => void;
  replaceFonts: (fonts: FontAsset[]) => void;
  replaceProject: (project: Project) => void;
  endHistoryGroup: () => void;
  undo: () => void;
  redo: () => void;
}

export const editorStore = createStore<EditorState>((set) => ({
  project: null,
  activeScreenId: null,
  selectedItems: [],
  historyPast: [],
  historyFuture: [],
  historyGroupKey: null,
  saveStatus: "idle",
  saveError: null,
  load: (project) =>
    set({
      project,
      activeScreenId: project.screens[0]?.id ?? null,
      selectedItems: [],
      historyPast: [],
      historyFuture: [],
      historyGroupKey: null,
      saveStatus: "idle",
      saveError: null,
    }),
  setSaveState: (saveStatus, saveError = null) => set({ saveStatus, saveError }),
  select: (id, screenId, mode = "replace") => set((state) => {
    if (id === null) return { selectedItems: [], historyGroupKey: null };
    const ownerScreenId = screenId ?? state.activeScreenId;
    if (!ownerScreenId) return state;
    const candidate = { screenId: ownerScreenId, elementId: id };
    const selectedItems = mode === "toggle"
      ? toggleSelection(state.selectedItems, candidate)
      : [candidate];
    return {
      selectedItems,
      historyGroupKey: null,
      ...(state.project?.mode === "connected" ? { activeScreenId: ownerScreenId } : {}),
    };
  }),
  setSelection: (items) => set((state) => {
    if (!state.project) return state;
    return {
      selectedItems: reconcileSelection(state.project, state.activeScreenId, items),
      historyGroupKey: null,
    };
  }),
  patchElement: ({ id, type, patch, screenId }) =>
    set((state) => {
      if (!state.project) return state;
      const primary = primarySelection(state.selectedItems);
      const ownerScreenId = screenId
        ?? (primary?.elementId === id ? primary.screenId : null)
        ?? state.activeScreenId;
      if (!ownerScreenId) return state;
      const project = produce(state.project, (draft) => {
        const screen = draft.screens.find((candidate) => candidate.id === ownerScreenId);
        const location = screen ? findElementLocation(screen, id) : null;
        if (location) applyMatchingElementPatch(location.element, { type, patch });
      });
      return recordProjectChange(state, project, `element:${ownerScreenId}:${id}`);
    }),
  moveSelected: (delta) =>
    set((state) => {
      if (!state.project || state.selectedItems.length === 0 || (delta.x === 0 && delta.y === 0)) return state;
      const project = produce(state.project, (draft) => {
        forEachSelectedElement(draft, state.selectedItems, ({ element, parent }) => {
          if (element.locked || parent?.locked) return;
          element.x += delta.x;
          element.y += delta.y;
        });
      });
      return recordProjectChange(state, project);
    }),
  removeSelected: () =>
    set((state) => {
      if (!state.project || state.selectedItems.length === 0) return state;
      const project = produce(state.project, (draft) => {
        forEachSelectedElement(draft, state.selectedItems, ({
          screen,
          parent,
          elementIndex,
          childIndex,
        }) => {
          if (!parent) {
            screen.elements.splice(elementIndex, 1);
            return;
          }
          parent.children.splice(childIndex!, 1);
          if (parent.children.length === 0) screen.elements.splice(elementIndex, 1);
        });
      });
      return recordProjectChange(state, project, null, { selectedItems: [] });
    }),
  setSelectedLocked: (locked) =>
    set((state) => {
      if (!state.project || state.selectedItems.length === 0) return state;
      const project = produce(state.project, (draft) => {
        forEachSelectedElement(draft, state.selectedItems, ({ element }) => {
          element.locked = locked;
        });
      });
      return recordProjectChange(state, project);
    }),
  setSelectedVisible: (visible) =>
    set((state) => {
      if (!state.project || state.selectedItems.length === 0) return state;
      const project = produce(state.project, (draft) => {
        forEachSelectedElement(draft, state.selectedItems, ({ element }) => {
          element.visible = visible;
        });
      });
      return recordProjectChange(state, project, null, visible ? {} : { selectedItems: [] });
    }),
  groupSelected: () =>
    set((state) => {
      if (!state.project || state.selectedItems.length < 2) return state;
      const ownerIds = new Set(state.selectedItems.map((item) => item.screenId));
      if (ownerIds.size !== 1) return state;
      const ownerScreenId = state.selectedItems[0]!.screenId;
      const owner = state.project.screens.find((screen) => screen.id === ownerScreenId);
      if (!owner) return state;
      const locations = state.selectedItems.map((item) => findElementLocation(owner, item.elementId));
      if (locations.some((location) => !location || location.parent || location.element.type === "group")) return state;
      const result = groupElementsCore(owner, state.selectedItems.map((item) => item.elementId));
      const project = produce(state.project, (draft) => {
        const index = draft.screens.findIndex((screen) => screen.id === ownerScreenId);
        if (index >= 0) draft.screens[index] = result.screen;
      });
      return recordProjectChange(state, project, null, {
        activeScreenId: ownerScreenId,
        selectedItems: [{ screenId: ownerScreenId, elementId: result.group.id }],
      });
    }),
  ungroupSelected: () =>
    set((state) => {
      if (!state.project || state.selectedItems.length === 0) return state;
      let project = state.project;
      const selectedItems: SelectionRef[] = [];
      for (const selection of state.selectedItems) {
        const screen = project.screens.find((candidate) => candidate.id === selection.screenId);
        const location = screen ? findElementLocation(screen, selection.elementId) : null;
        if (!screen || !location || location.parent || location.element.type !== "group") {
          return state;
        }
        const result = ungroupElementCore(screen, selection.elementId);
        project = {
          ...project,
          screens: project.screens.map((candidate) => candidate.id === screen.id ? result.screen : candidate),
        };
        selectedItems.push(...result.children.map((child) => ({
          screenId: screen.id,
          elementId: child.id,
        })));
      }
      return recordProjectChange(state, project, null, { selectedItems });
    }),
  duplicateSelected: () =>
    set((state) => {
      if (!state.project || state.selectedItems.length === 0) return state;
      const selectedByScreen = new Map<string, Set<string>>();
      for (const selection of state.selectedItems) {
        const screen = state.project.screens.find((candidate) => candidate.id === selection.screenId);
        const location = screen ? findElementLocation(screen, selection.elementId) : null;
        if (!location || location.parent) return state;
        const ids = selectedByScreen.get(selection.screenId) ?? new Set<string>();
        ids.add(selection.elementId);
        selectedByScreen.set(selection.screenId, ids);
      }
      const nextSelection: SelectionRef[] = [];
      const project: Project = {
        ...state.project,
        screens: state.project.screens.map((screen) => {
          const selectedIds = selectedByScreen.get(screen.id);
          if (!selectedIds) return screen;
          const elements: Element[] = [];
          for (const element of screen.elements) {
            elements.push(element);
            if (!selectedIds.has(element.id)) continue;
            const copy = duplicateElementCore(element);
            elements.push(copy);
            nextSelection.push({ screenId: screen.id, elementId: copy.id });
            selectedIds.delete(element.id);
          }
          return { ...screen, elements };
        }),
      };
      return recordProjectChange(state, project, null, { selectedItems: nextSelection });
    }),
  selectScreen: (id) => set({
    activeScreenId: id,
    selectedItems: [],
    historyGroupKey: null,
  }),
  selectLocale: (locale) =>
    set((state) => {
      const activeScreenId = state.project?.screens.find((screen) => screen.locale === locale)?.id;
      return activeScreenId
        ? { activeScreenId, selectedItems: [], historyGroupKey: null }
        : state;
    }),
  reorderScreens: (fromId, toId) =>
    set((state) => {
      if (!state.project) return state;
      return recordProjectChange(state, reorderProjectScreens(state.project, fromId, toId));
    }),
  setCanvasMode: (mode) =>
    set((state) => {
      if (!state.project) return state;
      const result = changeCanvasMode(
        state.project,
        state.activeScreenId,
        state.selectedItems,
        mode,
      );
      return recordProjectChange(state, result.project, null, result);
    }),
  addScreen: () =>
    set((state) => {
      if (!state.project) return state;
      const result = appendClonedScreen(state.project, state.activeScreenId);
      return recordProjectChange(state, result.project, null, result);
    }),
  addBlankScreen: () =>
    set((state) => {
      if (!state.project) return state;
      const result = appendBlankScreen(state.project, state.activeScreenId);
      return recordProjectChange(state, result.project, null, result);
    }),
  removeScreen: (id) =>
    set((state) => {
      if (!state.project) return state;
      const result = removeProjectScreen(
        state.project,
        id,
        state.activeScreenId,
        state.selectedItems,
      );
      return recordProjectChange(state, result.project, null, result);
    }),
  ensureStoreOutputFamily: (platform, device, leadTarget) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      const result = createStoreOutputFamily(
        state.project,
        state.activeScreenId,
        platform,
        device,
        leadTarget,
      );
      return recordProjectChange(state, result.project, null, result);
    }),
  ensureStoreTargetVariant: (target) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      const result = createStoreTargetVariant(state.project, state.activeScreenId, target);
      return recordProjectChange(state, result.project, null, result);
    }),
  removeStoreTargetVariant: (rootScreenId, storeTargetId) =>
    set((state) => {
      if (!state.project) return state;
      const result = deleteStoreTargetVariant(
        state.project,
        state.activeScreenId,
        state.selectedItems,
        rootScreenId,
        storeTargetId,
      );
      return recordProjectChange(state, result.project, null, result);
    }),
  addLocale: (sourceLocale, targetLocale, direction) =>
    set((state) => {
      if (!state.project) return state;
      const result = cloneProjectLocale(state.project, sourceLocale, targetLocale, direction);
      return recordProjectChange(state, result.project, null, result);
    }),
  setLocaleDirection: (locale, direction) =>
    set((state) => {
      if (!state.project) return state;
      return recordProjectChange(
        state,
        changeProjectLocaleDirection(state.project, locale, direction),
      );
    }),
  removeLocale: (locale) =>
    set((state) => {
      if (!state.project) return state;
      const result = deleteProjectLocale(
        state.project,
        state.activeScreenId,
        locale,
      );
      return recordProjectChange(state, result.project, null, result);
    }),
  reorderElements: (from, to) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      return recordProjectChange(
        state,
        reorderScreenElements(state.project, state.activeScreenId, from, to),
      );
    }),
  removeElement: (id, screenId) =>
    set((state) => {
      if (!state.project) return state;
      const result = removeScreenElement(
        state.project,
        state.activeScreenId,
        state.selectedItems,
        id,
        screenId,
      );
      return recordProjectChange(state, result.project, null, result);
    }),
  addElement: (element) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      const result = appendScreenElement(state.project, state.activeScreenId, element);
      return recordProjectChange(state, result.project, null, result);
    }),
  setBackground: (background) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      return recordProjectChange(
        state,
        setScreenBackground(state.project, state.activeScreenId, background),
        `background:${state.activeScreenId}`,
      );
    }),
  resizeArtboard: (size) =>
    set((state) => {
      if (!state.project || !state.activeScreenId) return state;
      return recordProjectChange(
        state,
        resizeProjectArtboards(state.project, state.activeScreenId, size),
      );
    }),
  replaceFonts: (fonts) =>
    set((state) => {
      if (!state.project) return state;
      return recordProjectChange(state, replaceProjectFonts(state.project, fonts));
    }),
  replaceProject: (project) =>
    set((state) => {
      return {
        project,
        ...selectionForProject(state, project),
        historyPast: [],
        historyFuture: [],
        historyGroupKey: null,
      };
    }),
  endHistoryGroup: () => set({ historyGroupKey: null }),
  undo: () => set((state) => undoProjectChange(state)),
  redo: () => set((state) => redoProjectChange(state)),
}));
