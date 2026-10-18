// SPDX-License-Identifier: Apache-2.0
import {
  addLayout as addLayoutCore,
  DEFAULT_BLANK_SCREEN_COLOR,
  duplicateLayout as duplicateLayoutCore,
  getLayout,
  preferLayout as preferLayoutCore,
  removeLayout as removeLayoutCore,
  renameLayout as renameLayoutCore,
  setLayoutMode as setLayoutModeCore,
  type CanvasMode,
  type DesignLayout,
  type Project,
} from "@screenshot-studio/core/model";
import type { EditorSet, EditorState } from "./editor-store.js";

/** Layout switching and layout CRUD; each layout keeps its own undo history. */
export interface EditorLayoutActions {
  selectLayout: (id: string) => void;
  addLayout: (name: string, mode: CanvasMode) => void;
  duplicateLayout: (id: string, name?: string) => void;
  renameLayout: (id: string, name: string) => void;
  setLayoutMode: (id: string, mode: CanvasMode) => void;
  preferLayout: (id: string) => void;
  removeLayout: (id: string) => void;
}

export function selectEditorLayout(
  state: Pick<EditorState, "project" | "activeLayoutId">,
): DesignLayout | null {
  if (!state.project || !state.activeLayoutId) return null;
  return state.project.layouts.find((layout) => layout.id === state.activeLayoutId) ?? null;
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

export function createEditorLayoutActions(set: EditorSet): EditorLayoutActions {
  return {
    selectLayout: (id) => set((state) => {
      if (!state.project || id === state.activeLayoutId) return state;
      return state.project.layouts.some((layout) => layout.id === id)
        ? activateLayout(state, state.project, id)
        : state;
    }),
    addLayout: (name, mode) => set((state) => {
      const layout = selectEditorLayout(state);
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
          background: { type: "solid", color: DEFAULT_BLANK_SCREEN_COLOR },
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
  };
}
