// SPDX-License-Identifier: Apache-2.0
import { createStore } from "zustand/vanilla";
import { produce } from "immer";
import {
  addLayout as addLayoutCore,
  duplicateElement as duplicateElementCore,
  duplicateLayout as duplicateLayoutCore,
  findElementLocation,
  getLayout,
  groupElements as groupElementsCore,
  preferLayout as preferLayoutCore,
  removeLayout as removeLayoutCore,
  renameLayout as renameLayoutCore,
  replaceLayout,
  setLayoutMode as setLayoutModeCore,
  ungroupElement as ungroupElementCore,
  type CanvasMode,
  type Background,
  type DesignLayout,
  type Project,
  type Element,
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
  type LayoutContentSnapshot,
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
  resizeProjectArtboards,
  setScreenBackground,
} from "./editor-screen-mutations.js";
import {
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
 * the foundation used by bounded undo/redo history.
 * The store is the only writer of project state; the canvas dispatches actions, never mutates.
 */

export interface EditorState {
  project: Project | null;
  activeLayoutId: string | null;
  activeScreenId: string | null;
  selectedItems: SelectionRef[];
  historyPast: LayoutContentSnapshot[];
  historyFuture: LayoutContentSnapshot[];
  layoutHistories: Record<string, { past: LayoutContentSnapshot[]; future: LayoutContentSnapshot[] }>;
  historyGroupKey: string | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
  load: (project: Project, locallyActiveLayoutId?: string) => void;
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
  selectLayout: (id: string) => void;
  addLayout: (name: string, mode: CanvasMode) => void;
  duplicateLayout: (id: string, name?: string) => void;
  renameLayout: (id: string, name: string) => void;
  setLayoutMode: (id: string, mode: CanvasMode) => void;
  preferLayout: (id: string) => void;
  removeLayout: (id: string) => void;
  selectScreen: (id: string) => void;
  selectLocale: (locale: string) => void;
  reorderScreens: (fromId: string, toId: string) => void;
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
  replaceProject: (project: Project) => void;
  endHistoryGroup: () => void;
  undo: () => void;
  redo: () => void;
}

function currentLayout(state: Pick<EditorState, "project" | "activeLayoutId">): DesignLayout | null {
  if (!state.project || !state.activeLayoutId) return null;
  return state.project.layouts.find((layout) => layout.id === state.activeLayoutId) ?? null;
}

export function selectEditorLayout(
  state: Pick<EditorState, "project" | "activeLayoutId">,
): DesignLayout | null {
  return currentLayout(state);
}

function activateLayout(
  state: EditorState,
  project: Project,
  layoutId: string,
): Partial<EditorState> {
  const layout = getLayout(project, layoutId);
  const layoutHistories = state.activeLayoutId
    ? {
        ...state.layoutHistories,
        [state.activeLayoutId]: { past: state.historyPast, future: state.historyFuture },
      }
    : state.layoutHistories;
  const history = layoutHistories[layout.id] ?? { past: [], future: [] };
  return {
    project,
    activeLayoutId: layout.id,
    activeScreenId: layout.screens[0]?.id ?? null,
    selectedItems: [],
    historyPast: history.past,
    historyFuture: history.future,
    layoutHistories,
    historyGroupKey: null,
  };
}

export const editorStore = createStore<EditorState>((set) => ({
  project: null,
  activeLayoutId: null,
  activeScreenId: null,
  selectedItems: [],
  historyPast: [],
  historyFuture: [],
  layoutHistories: {},
  historyGroupKey: null,
  saveStatus: "idle",
  saveError: null,
  load: (project, locallyActiveLayoutId) => {
    const activeLayout = project.layouts.find((layout) => layout.id === locallyActiveLayoutId)
      ?? getLayout(project, project.preferredExportLayoutId);
    set({
      project,
      activeLayoutId: activeLayout.id,
      activeScreenId: activeLayout.screens[0]?.id ?? null,
      selectedItems: [],
      historyPast: [],
      historyFuture: [],
      layoutHistories: {},
      historyGroupKey: null,
      saveStatus: "idle",
      saveError: null,
    });
  },
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
      ...(currentLayout(state)?.mode === "connected" ? { activeScreenId: ownerScreenId } : {}),
    };
  }),
  setSelection: (items) => set((state) => {
    const layout = currentLayout(state);
    if (!layout) return state;
    return {
      selectedItems: reconcileSelection(layout, state.activeScreenId, items),
      historyGroupKey: null,
    };
  }),
  patchElement: ({ id, type, patch, screenId }) =>
    set((state) => {
      if (!state.project || !state.activeLayoutId) return state;
      const primary = primarySelection(state.selectedItems);
      const ownerScreenId = screenId
        ?? (primary?.elementId === id ? primary.screenId : null)
        ?? state.activeScreenId;
      if (!ownerScreenId) return state;
      const project = produce(state.project, (draft) => {
        const screen = draft.layouts.find((layout) => layout.id === state.activeLayoutId)?.screens
          .find((candidate) => candidate.id === ownerScreenId);
        const location = screen ? findElementLocation(screen, id) : null;
        if (location) applyMatchingElementPatch(location.element, { type, patch });
      });
      return recordProjectChange(state, project, `element:${ownerScreenId}:${id}`);
    }),
  moveSelected: (delta) =>
    set((state) => {
      if (!state.project || !state.activeLayoutId || state.selectedItems.length === 0 || (delta.x === 0 && delta.y === 0)) return state;
      const project = produce(state.project, (draft) => {
        const layout = draft.layouts.find((candidate) => candidate.id === state.activeLayoutId)!;
        forEachSelectedElement(layout, state.selectedItems, ({ element, parent }) => {
          if (element.locked || parent?.locked) return;
          element.x += delta.x;
          element.y += delta.y;
        });
      });
      return recordProjectChange(state, project);
    }),
  removeSelected: () =>
    set((state) => {
      if (!state.project || !state.activeLayoutId || state.selectedItems.length === 0) return state;
      const project = produce(state.project, (draft) => {
        const layout = draft.layouts.find((candidate) => candidate.id === state.activeLayoutId)!;
        forEachSelectedElement(layout, state.selectedItems, ({
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
      if (!state.project || !state.activeLayoutId || state.selectedItems.length === 0) return state;
      const project = produce(state.project, (draft) => {
        const layout = draft.layouts.find((candidate) => candidate.id === state.activeLayoutId)!;
        forEachSelectedElement(layout, state.selectedItems, ({ element }) => {
          element.locked = locked;
        });
      });
      return recordProjectChange(state, project);
    }),
  setSelectedVisible: (visible) =>
    set((state) => {
      if (!state.project || !state.activeLayoutId || state.selectedItems.length === 0) return state;
      const project = produce(state.project, (draft) => {
        const layout = draft.layouts.find((candidate) => candidate.id === state.activeLayoutId)!;
        forEachSelectedElement(layout, state.selectedItems, ({ element }) => {
          element.visible = visible;
        });
      });
      return recordProjectChange(state, project, null, visible ? {} : { selectedItems: [] });
    }),
  groupSelected: () =>
    set((state) => {
      const layout = currentLayout(state);
      if (!state.project || !state.activeLayoutId || !layout || state.selectedItems.length < 2) return state;
      const ownerIds = new Set(state.selectedItems.map((item) => item.screenId));
      if (ownerIds.size !== 1) return state;
      const ownerScreenId = state.selectedItems[0]!.screenId;
      const owner = layout.screens.find((screen) => screen.id === ownerScreenId);
      if (!owner) return state;
      const locations = state.selectedItems.map((item) => findElementLocation(owner, item.elementId));
      if (locations.some((location) => !location || location.parent || location.element.type === "group")) return state;
      const result = groupElementsCore(owner, state.selectedItems.map((item) => item.elementId));
      const project = produce(state.project, (draft) => {
        const screens = draft.layouts.find((candidate) => candidate.id === state.activeLayoutId)!.screens;
        const index = screens.findIndex((screen) => screen.id === ownerScreenId);
        if (index >= 0) screens[index] = result.screen;
      });
      return recordProjectChange(state, project, null, {
        activeScreenId: ownerScreenId,
        selectedItems: [{ screenId: ownerScreenId, elementId: result.group.id }],
      });
    }),
  ungroupSelected: () =>
    set((state) => {
      if (!state.project || !state.activeLayoutId || state.selectedItems.length === 0) return state;
      let project = state.project;
      const selectedItems: SelectionRef[] = [];
      for (const selection of state.selectedItems) {
        const screen = getLayout(project, state.activeLayoutId).screens
          .find((candidate) => candidate.id === selection.screenId);
        const location = screen ? findElementLocation(screen, selection.elementId) : null;
        if (!screen || !location || location.parent || location.element.type !== "group") {
          return state;
        }
        const result = ungroupElementCore(screen, selection.elementId);
        project = produce(project, (draft) => {
          const screens = draft.layouts.find((candidate) => candidate.id === state.activeLayoutId)!.screens;
          const index = screens.findIndex((candidate) => candidate.id === screen.id);
          if (index >= 0) screens[index] = result.screen;
        });
        selectedItems.push(...result.children.map((child) => ({
          screenId: screen.id,
          elementId: child.id,
        })));
      }
      return recordProjectChange(state, project, null, { selectedItems });
    }),
  duplicateSelected: () =>
    set((state) => {
      const layout = currentLayout(state);
      if (!state.project || !state.activeLayoutId || !layout || state.selectedItems.length === 0) return state;
      const selectedByScreen = new Map<string, Set<string>>();
      for (const selection of state.selectedItems) {
        const screen = layout.screens.find((candidate) => candidate.id === selection.screenId);
        const location = screen ? findElementLocation(screen, selection.elementId) : null;
        if (!location || location.parent) return state;
        const ids = selectedByScreen.get(selection.screenId) ?? new Set<string>();
        ids.add(selection.elementId);
        selectedByScreen.set(selection.screenId, ids);
      }
      const nextSelection: SelectionRef[] = [];
      const screens = layout.screens.map((screen) => {
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
        });
      const project = replaceLayout(state.project, {
        ...layout,
        screens,
      });
      return recordProjectChange(state, project, null, { selectedItems: nextSelection });
    }),
  selectLayout: (id) => set((state) => {
    if (!state.project || id === state.activeLayoutId) return state;
    return state.project.layouts.some((layout) => layout.id === id)
      ? activateLayout(state, state.project, id)
      : state;
  }),
  addLayout: (name, mode) => set((state) => {
    const layout = currentLayout(state);
    if (!state.project || !layout) return state;
    const source = layout.screens.find((screen) => screen.id === state.activeScreenId)
      ?? layout.screens[0]!;
    const result = addLayoutCore(state.project, {
      name,
      mode,
      screen: {
        platform: source.platform,
        device: source.device,
        locale: source.locale,
        direction: source.direction,
        artboard: source.artboard,
        background: { type: "solid", color: "#101827" },
      },
    });
    return activateLayout(state, result.project, result.layout.id);
  }),
  duplicateLayout: (id, name) => set((state) => {
    if (!state.project) return state;
    const result = duplicateLayoutCore(state.project, id, name);
    return activateLayout(state, result.project, result.layout.id);
  }),
  renameLayout: (id, name) => set((state) => state.project
    ? { project: renameLayoutCore(state.project, id, name) }
    : state),
  setLayoutMode: (id, mode) => set((state) => state.project
    ? { project: setLayoutModeCore(state.project, id, mode) }
    : state),
  preferLayout: (id) => set((state) => state.project
    ? { project: preferLayoutCore(state.project, id) }
    : state),
  removeLayout: (id) => set((state) => {
    if (!state.project) return state;
    const result = removeLayoutCore(state.project, id);
    const { [id]: _removed, ...layoutHistories } = state.layoutHistories;
    if (state.activeLayoutId !== id) return { project: result.project, layoutHistories };
    return { ...activateLayout({ ...state, layoutHistories }, result.project, result.layout.id), layoutHistories };
  }),
  selectScreen: (id) => set({
    activeScreenId: id,
    selectedItems: [],
    historyGroupKey: null,
  }),
  selectLocale: (locale) =>
    set((state) => {
      const activeScreenId = currentLayout(state)?.screens
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
  ensureStoreOutputFamily: (platform, device, leadTarget) =>
    set((state) => {
      if (!state.project || !state.activeLayoutId || !state.activeScreenId) return state;
      const result = createStoreOutputFamily(
        state.project,
        state.activeLayoutId,
        state.activeScreenId,
        platform,
        device,
        leadTarget,
      );
      return recordProjectChange(state, result.project, null, result);
    }),
  ensureStoreTargetVariant: (target) =>
    set((state) => {
      if (!state.project || !state.activeLayoutId || !state.activeScreenId) return state;
      const result = createStoreTargetVariant(
        state.project,
        state.activeLayoutId,
        state.activeScreenId,
        target,
      );
      return recordProjectChange(state, result.project, null, result);
    }),
  removeStoreTargetVariant: (rootScreenId, storeTargetId) =>
    set((state) => {
      if (!state.project || !state.activeLayoutId) return state;
      const result = deleteStoreTargetVariant(
        state.project,
        state.activeLayoutId,
        state.activeScreenId,
        state.selectedItems,
        rootScreenId,
        storeTargetId,
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
  replaceProject: (project) =>
    set((state) => {
      const activeLayoutId = project.layouts.some((layout) => layout.id === state.activeLayoutId)
        ? state.activeLayoutId!
        : project.preferredExportLayoutId;
      const nextState = { ...state, activeLayoutId };
      return {
        project,
        activeLayoutId,
        ...selectionForProject(nextState, project),
        historyPast: [],
        historyFuture: [],
        layoutHistories: {},
        historyGroupKey: null,
      };
    }),
  endHistoryGroup: () => set({ historyGroupKey: null }),
  undo: () => set((state) => undoProjectChange(state)),
  redo: () => set((state) => redoProjectChange(state)),
}));
