// SPDX-License-Identifier: Apache-2.0
import {
  getLayout,
  replaceLayout,
  type DesignLayout,
  type Project,
} from "@screenshot-studio/core/model";
import { reconcileSelection, type SelectionRef } from "./editor-selection.js";

export type LayoutContentSnapshot = DesignLayout["screens"];

export interface EditorHistorySnapshot {
  project: Project | null;
  activeLayoutId: string | null;
  activeScreenId: string | null;
  selectedItems: SelectionRef[];
  historyPast: LayoutContentSnapshot[];
  historyFuture: LayoutContentSnapshot[];
  historyGroupKey: string | null;
}

const HISTORY_LIMIT = 50;

function activeLayout(state: EditorHistorySnapshot): DesignLayout | null {
  if (!state.project || !state.activeLayoutId) return null;
  return state.project.layouts.find((layout) => layout.id === state.activeLayoutId) ?? null;
}

export function recordProjectChange(
  state: EditorHistorySnapshot,
  project: Project,
  historyGroupKey: string | null = null,
  extra: Partial<EditorHistorySnapshot> = {},
): EditorHistorySnapshot | Partial<EditorHistorySnapshot> {
  const currentLayout = activeLayout(state);
  if (!state.project || !state.activeLayoutId || !currentLayout || project === state.project) return state;
  const nextLayout = getLayout(project, state.activeLayoutId);
  if (nextLayout.screens === currentLayout.screens) return { project, ...extra };
  const continuesGroup = historyGroupKey !== null && state.historyGroupKey === historyGroupKey;
  const historyPast = continuesGroup
    ? state.historyPast
    : [...state.historyPast, currentLayout.screens].slice(-HISTORY_LIMIT);
  return {
    project,
    historyPast,
    historyFuture: [],
    historyGroupKey,
    ...extra,
  };
}

export function selectionForProject(state: EditorHistorySnapshot, project: Project) {
  if (!state.activeLayoutId) return { activeScreenId: null, selectedItems: [] };
  const layout = getLayout(project, state.activeLayoutId);
  const activeScreenId = layout.screens.some((screen) => screen.id === state.activeScreenId)
    ? state.activeScreenId
    : layout.screens[0]?.id ?? null;
  return {
    activeScreenId,
    selectedItems: reconcileSelection(layout, activeScreenId, state.selectedItems),
  };
}

function projectWithScreens(state: EditorHistorySnapshot, screens: LayoutContentSnapshot): Project {
  const layout = getLayout(state.project!, state.activeLayoutId!);
  return replaceLayout(state.project!, { ...layout, screens });
}

export function undoProjectChange(state: EditorHistorySnapshot): EditorHistorySnapshot {
  const layout = activeLayout(state);
  if (!state.project || !layout || state.historyPast.length === 0) return state;
  const screens = state.historyPast.at(-1)!;
  const project = projectWithScreens(state, screens);
  return {
    ...state,
    project,
    ...selectionForProject(state, project),
    historyPast: state.historyPast.slice(0, -1),
    historyFuture: [layout.screens, ...state.historyFuture].slice(0, HISTORY_LIMIT),
    historyGroupKey: null,
  };
}

export function redoProjectChange(state: EditorHistorySnapshot): EditorHistorySnapshot {
  const layout = activeLayout(state);
  if (!state.project || !layout || state.historyFuture.length === 0) return state;
  const [screens, ...historyFuture] = state.historyFuture;
  const project = projectWithScreens(state, screens!);
  return {
    ...state,
    project,
    ...selectionForProject(state, project),
    historyPast: [...state.historyPast, layout.screens].slice(-HISTORY_LIMIT),
    historyFuture,
    historyGroupKey: null,
  };
}
