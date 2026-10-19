// SPDX-License-Identifier: Apache-2.0
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Project } from "@screenshot-studio/core/model";
import type { SelectionRef } from "./editor-selection.js";
import type { LayoutContentSnapshot } from "./editor-history.js";
import { createEditorLayoutActions, type EditorLayoutActions } from "./editor-store-layouts.js";
import { createEditorOutputActions, type EditorOutputActions } from "./editor-store-outputs.js";
import { createEditorScreenActions, type EditorScreenActions } from "./editor-store-screens.js";
import {
  createEditorSelectionActions,
  type EditorSelectionActions,
} from "./editor-store-selection.js";
import { createEditorSessionActions, type EditorSessionActions } from "./editor-store-session.js";

export {
  applyElementPatch,
  type CommonElementPatch,
  type ElementPatch,
  type ElementPatchFor,
  type ElementPatchRequest,
} from "./editor-element-patch.js";
export { selectEditorLayout } from "./editor-store-layouts.js";
export type { PatchElementRequest } from "./editor-store-selection.js";

/**
 * Editor state as a framework-agnostic Zustand vanilla store, bound to React via `useStore` in
 * components. Every mutation goes through Immer, so each change is a discrete immutable patch —
 * the foundation used by bounded undo/redo history.
 * The store is the only writer of project state; the canvas dispatches actions, never mutates.
 * Actions live in one slice per editor domain; this module only composes them.
 */
export interface EditorState
  extends EditorSessionActions,
    EditorSelectionActions,
    EditorLayoutActions,
    EditorScreenActions,
    EditorOutputActions {
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
}

export type EditorSet = StoreApi<EditorState>["setState"];

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
  ...createEditorSessionActions(set),
  ...createEditorSelectionActions(set),
  ...createEditorLayoutActions(set),
  ...createEditorScreenActions(set),
  ...createEditorOutputActions(set),
}));
