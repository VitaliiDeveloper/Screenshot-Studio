// SPDX-License-Identifier: Apache-2.0
import type { Project } from "@screenshot-studio/core/model";
import { reconcileSelection, type SelectionRef } from "./editor-selection.js";

export interface EditorHistorySnapshot {
  project: Project | null;
  activeScreenId: string | null;
  selectedItems: SelectionRef[];
  historyPast: Project[];
  historyFuture: Project[];
  historyGroupKey: string | null;
}

const HISTORY_LIMIT = 50;

export function recordProjectChange(
  state: EditorHistorySnapshot,
  project: Project,
  historyGroupKey: string | null = null,
  extra: Partial<EditorHistorySnapshot> = {},
): EditorHistorySnapshot | Partial<EditorHistorySnapshot> {
  if (!state.project || project === state.project) return state;
  const continuesGroup = historyGroupKey !== null && state.historyGroupKey === historyGroupKey;
  const historyPast = continuesGroup
    ? state.historyPast
    : [...state.historyPast, state.project].slice(-HISTORY_LIMIT);
  return {
    project,
    historyPast,
    historyFuture: [],
    historyGroupKey,
    ...extra,
  };
}

export function selectionForProject(state: EditorHistorySnapshot, project: Project) {
  const activeScreenId = project.screens.some((screen) => screen.id === state.activeScreenId)
    ? state.activeScreenId
    : project.screens[0]?.id ?? null;
  return {
    activeScreenId,
    selectedItems: reconcileSelection(project, activeScreenId, state.selectedItems),
  };
}

export function undoProjectChange(state: EditorHistorySnapshot): EditorHistorySnapshot {
  if (!state.project || state.historyPast.length === 0) return state;
  const project = state.historyPast.at(-1)!;
  return {
    ...state,
    project,
    ...selectionForProject(state, project),
    historyPast: state.historyPast.slice(0, -1),
    historyFuture: [state.project, ...state.historyFuture].slice(0, HISTORY_LIMIT),
    historyGroupKey: null,
  };
}

export function redoProjectChange(state: EditorHistorySnapshot): EditorHistorySnapshot {
  if (!state.project || state.historyFuture.length === 0) return state;
  const [project, ...historyFuture] = state.historyFuture;
  return {
    ...state,
    project: project!,
    ...selectionForProject(state, project!),
    historyPast: [...state.historyPast, state.project].slice(-HISTORY_LIMIT),
    historyFuture,
    historyGroupKey: null,
  };
}
