// SPDX-License-Identifier: Apache-2.0
import { produce } from "immer";
import {
  duplicateElement as duplicateElementCore,
  findElementLocation,
  getLayout,
  groupElements as groupElementsCore,
  replaceLayout,
  ungroupElement as ungroupElementCore,
  type Element,
} from "@screenshot-studio/core/model";
import {
  arrangeSelectionDeltas,
  primarySelection,
  reconcileSelection,
  selectionKey,
  toggleSelection,
  type ArrangeAction,
  type SelectionRef,
} from "./editor-selection.js";
import {
  applyMatchingElementPatch,
  type ElementPatchRequest,
} from "./editor-element-patch.js";
import { forEachSelectedElement } from "./editor-selection-mutations.js";
import { recordProjectChange } from "./editor-history.js";
import { selectEditorLayout } from "./editor-store-layouts.js";
import type { EditorSet } from "./editor-store.js";

export type PatchElementRequest<T extends Element["type"] = Element["type"]> =
  ElementPatchRequest<T> & { id: string; screenId?: string };

export interface EditorSelectionActions {
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
  arrangeSelected: (action: ArrangeAction) => void;
  setSelectedOpacity: (opacity: number) => void;
}

export function createEditorSelectionActions(set: EditorSet): EditorSelectionActions {
  return {
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
        ...(selectEditorLayout(state)?.mode === "connected" ? { activeScreenId: ownerScreenId } : {}),
      };
    }),
    setSelection: (items) => set((state) => {
      const layout = selectEditorLayout(state);
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
        const layout = selectEditorLayout(state);
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
        const layout = selectEditorLayout(state);
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
    arrangeSelected: (action) =>
      set((state) => {
        const layout = selectEditorLayout(state);
        if (!state.project || !state.activeLayoutId || !state.activeScreenId || !layout || state.selectedItems.length < 2) return state;
        // selectionBounds measures top-level layers only, so group children cannot be arranged against it.
        const nested = state.selectedItems.some((selection) => {
          const screen = layout.screens.find((candidate) => candidate.id === selection.screenId);
          const location = screen ? findElementLocation(screen, selection.elementId) : null;
          return !location || location.parent;
        });
        if (nested) return state;
        const deltas = arrangeSelectionDeltas(layout, state.activeScreenId, state.selectedItems, action);
        const project = produce(state.project, (draft) => {
          const draftLayout = draft.layouts.find((candidate) => candidate.id === state.activeLayoutId)!;
          forEachSelectedElement(draftLayout, state.selectedItems, ({ screen, element }) => {
            const delta = deltas.get(selectionKey({ screenId: screen.id, elementId: element.id }));
            // Skipping float-noise deltas keeps an already-arranged click out of history.
            if (!delta || element.locked || (Math.abs(delta.x) < 1e-9 && Math.abs(delta.y) < 1e-9)) return;
            element.x += delta.x;
            element.y += delta.y;
          });
        });
        return recordProjectChange(state, project);
      }),
    setSelectedOpacity: (opacity) =>
      set((state) => {
        if (!state.project || !state.activeLayoutId || state.selectedItems.length === 0) return state;
        const project = produce(state.project, (draft) => {
          const layout = draft.layouts.find((candidate) => candidate.id === state.activeLayoutId)!;
          forEachSelectedElement(layout, state.selectedItems, ({ element, parent }) => {
            if (element.locked || parent?.locked) return;
            element.opacity = opacity;
          });
        });
        return recordProjectChange(state, project, "selection-opacity");
      }),
  };
}
