// SPDX-License-Identifier: Apache-2.0
import {
  getLayout,
  replaceLayout,
  type DesignLayout,
  type Project,
} from "@screenshot-studio/core/model";
import { reconcileSelection, type SelectionRef } from "./editor-selection.js";

export interface LayoutContentSnapshot {
  screens: DesignLayout["screens"];
  screenSetPolicies: DesignLayout["screenSetPolicies"];
}

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

function layoutContentSnapshot(layout: DesignLayout): LayoutContentSnapshot {
  return {
    screens: layout.screens,
    screenSetPolicies: layout.screenSetPolicies,
  };
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
  if (
    nextLayout.screens === currentLayout.screens
    && nextLayout.screenSetPolicies === currentLayout.screenSetPolicies
  ) return { project, ...extra };
  const continuesGroup = historyGroupKey !== null && state.historyGroupKey === historyGroupKey;
  const historyPast = continuesGroup
    ? state.historyPast
    : [...state.historyPast, layoutContentSnapshot(currentLayout)].slice(-HISTORY_LIMIT);
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

function projectWithLayoutContent(
  state: EditorHistorySnapshot,
  snapshot: LayoutContentSnapshot,
): Project {
  const layout = getLayout(state.project!, state.activeLayoutId!);
  return replaceLayout(state.project!, {
    ...layout,
    screens: snapshot.screens,
    screenSetPolicies: snapshot.screenSetPolicies,
  });
}

export function undoProjectChange(state: EditorHistorySnapshot): EditorHistorySnapshot {
  const layout = activeLayout(state);
  if (!state.project || !layout || state.historyPast.length === 0) return state;
  const snapshot = state.historyPast.at(-1)!;
  const project = projectWithLayoutContent(state, snapshot);
  return {
    ...state,
    project,
    ...selectionForProject(state, project),
    historyPast: state.historyPast.slice(0, -1),
    historyFuture: [layoutContentSnapshot(layout), ...state.historyFuture].slice(0, HISTORY_LIMIT),
    historyGroupKey: null,
  };
}

export function redoProjectChange(state: EditorHistorySnapshot): EditorHistorySnapshot {
  const layout = activeLayout(state);
  if (!state.project || !layout || state.historyFuture.length === 0) return state;
  const [snapshot, ...historyFuture] = state.historyFuture;
  const project = projectWithLayoutContent(state, snapshot!);
  return {
    ...state,
    project,
    ...selectionForProject(state, project),
    historyPast: [...state.historyPast, layoutContentSnapshot(layout)].slice(-HISTORY_LIMIT),
    historyFuture,
    historyGroupKey: null,
  };
}
