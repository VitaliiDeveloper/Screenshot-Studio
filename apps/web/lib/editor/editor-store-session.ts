// SPDX-License-Identifier: Apache-2.0
import { getLayout, type Project } from "@screenshot-studio/core/model";
import { reconcileSelection } from "./editor-selection.js";
import {
  redoProjectChange,
  selectionForProject,
  undoProjectChange,
} from "./editor-history.js";
import type { EditorSet, EditorState } from "./editor-store.js";

/** Project lifecycle, save status, and undo/redo for the whole editor session. */
export interface EditorSessionActions {
  load: (project: Project, locallyActiveLayoutId?: string) => void;
  reloadProject: (project: Project) => void;
  resetProjectState: () => void;
  setSaveState: (status: EditorState["saveStatus"], error?: string | null) => void;
  replaceProject: (project: Project) => void;
  endHistoryGroup: () => void;
  undo: () => void;
  redo: () => void;
}

export function createEditorSessionActions(set: EditorSet): EditorSessionActions {
  return {
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
    reloadProject: (project) => set((state) => {
      const activeLayout = project.layouts.find((layout) => layout.id === state.activeLayoutId)
        ?? getLayout(project, project.preferredExportLayoutId);
      const activeScreenId = activeLayout.screens.some((screen) => screen.id === state.activeScreenId)
        ? state.activeScreenId
        : activeLayout.screens[0]?.id ?? null;
      return {
        project,
        activeLayoutId: activeLayout.id,
        activeScreenId,
        selectedItems: reconcileSelection(activeLayout, activeScreenId, state.selectedItems),
        historyPast: [],
        historyFuture: [],
        layoutHistories: {},
        historyGroupKey: null,
        saveStatus: "idle",
        saveError: null,
      };
    }),
    resetProjectState: () => set({
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
    }),
    setSaveState: (saveStatus, saveError = null) => set({ saveStatus, saveError }),
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
  };
}
