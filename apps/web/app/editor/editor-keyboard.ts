// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect } from "react";
import { createShapeElement, createTextElement, preferredAuthoringFont } from "@screenshot-studio/core/model";
import type { ResourceDialog, WorkspacePanel } from "@web/lib/editor/editor-workspace";
import { editorStore } from "@web/lib/editor/editor-store";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";

export type EditorKeyboardCommand =
  | "undo"
  | "redo"
  | "group"
  | "ungroup"
  | "duplicate"
  | "templates"
  | "delete"
  | "add-text"
  | "add-shape"
  | "nudge"
  | "search"
  | "export"
  | "toggle-view"
  | "prev-size"
  | "next-size";

export interface EditorKeyboardHandlers {
  onOpenDialog: (dialog: ResourceDialog) => void;
  onSearch: () => void;
  onExport: () => void;
  onToggleView: () => void;
  onStepSize: (step: -1 | 1) => void;
}

const NUDGE_DIRECTIONS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** Handoff § 6: arrows nudge the selection 10 px, 50 px with Shift. */
export function nudgeDelta(key: string, shiftKey: boolean): { x: number; y: number } | null {
  const direction = NUDGE_DIRECTIONS[key];
  if (!direction) return null;
  const step = shiftKey ? 50 : 10;
  return { x: direction.x * step, y: direction.y * step };
}

export interface EditorKeyboardInput {
  key: string;
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  interactive: boolean;
  /** Focus is in a field that types text; a focused button or link is interactive but not this. */
  textEntry: boolean;
  modalOpen: boolean;
  /** A non-modal menu is open; its arrow keys move between items. */
  menuOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
}

export function resolveEditorKeyboardCommand(input: EditorKeyboardInput): EditorKeyboardCommand | null {
  if (input.repeat || input.modalOpen) return null;
  const key = input.key.toLowerCase();
  const modifier = input.metaKey || input.ctrlKey;
  // Navigation keys also work right after a click leaves focus on a button or layer row.
  if (!input.textEntry && !input.menuOpen && !input.altKey) {
    if (modifier && !input.shiftKey) {
      if (key === "k") return "search";
      if (key === "e") return "export";
    } else if (!modifier) {
      if (key === "o") return "toggle-view";
      if (input.key === "[") return "prev-size";
      if (input.key === "]") return "next-size";
    }
  }
  if (input.interactive) return null;
  if (modifier && key === "z") {
    if (input.shiftKey) return input.canRedo ? "redo" : null;
    return input.canUndo ? "undo" : null;
  }
  if (input.ctrlKey && key === "y") return input.canRedo ? "redo" : null;
  if (modifier && key === "g") return input.shiftKey ? "ungroup" : "group";
  if (modifier && key === "d") return input.hasSelection ? "duplicate" : null;
  if (modifier && input.key === "/") return "templates";
  if (input.metaKey || input.ctrlKey || input.altKey) return null;
  if (input.key === "Delete" || input.key === "Backspace") return input.hasSelection ? "delete" : null;
  if (nudgeDelta(input.key, false)) return input.hasSelection && !input.menuOpen ? "nudge" : null;
  if (key === "t") return "add-text";
  if (key === "r") return "add-shape";
  return null;
}

const TEXT_ENTRY_TARGETS = "input, textarea, select, [role='dialog'], [contenteditable='true']";

function targetMatches(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

export function routeEditorKeyDown(event: KeyboardEvent, handlers: EditorKeyboardHandlers) {
  const state = editorStore.getState();
  const command = resolveEditorKeyboardCommand({
    key: event.key,
    repeat: event.repeat,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    interactive: targetMatches(event.target, `${TEXT_ENTRY_TARGETS}, button, a`),
    textEntry: targetMatches(event.target, TEXT_ENTRY_TARGETS),
    modalOpen: Boolean(document.querySelector("[role='dialog'][aria-modal='true']")),
    menuOpen: Boolean(document.querySelector("[role='menu']:not([hidden])")),
    canUndo: state.historyPast.length > 0,
    canRedo: state.historyFuture.length > 0,
    hasSelection: state.selectedItems.length > 0,
  });
  if (!command) return;
  // Ctrl+K and Ctrl+E focus the address bar in Chrome on Windows and Linux.
  event.preventDefault();
  switch (command) {
    case "undo":
      mutateAndSave(() => editorStore.getState().undo());
      return;
    case "redo":
      mutateAndSave(() => editorStore.getState().redo());
      return;
    case "group":
      mutateAndSave(() => editorStore.getState().groupSelected());
      return;
    case "ungroup":
      mutateAndSave(() => editorStore.getState().ungroupSelected());
      return;
    case "duplicate":
      mutateAndSave(() => editorStore.getState().duplicateSelected());
      return;
    case "templates":
      handlers.onOpenDialog("templates");
      return;
    case "search":
      handlers.onSearch();
      return;
    case "export":
      handlers.onExport();
      return;
    case "toggle-view":
      handlers.onToggleView();
      return;
    case "prev-size":
      handlers.onStepSize(-1);
      return;
    case "next-size":
      handlers.onStepSize(1);
      return;
    case "delete":
      mutateAndSave(() => editorStore.getState().removeSelected());
      return;
    case "add-text": {
      const current = editorStore.getState();
      const font = current.project?.fonts[0];
      const direction = current.project?.layouts
        .find((layout) => layout.id === current.activeLayoutId)?.screens
        .find((screen) => screen.id === current.activeScreenId)?.direction;
      mutateAndSave(() => editorStore.getState().addElement(createTextElement({
        font: preferredAuthoringFont(font ? [font] : []),
        direction,
      })));
      return;
    }
    case "add-shape":
      mutateAndSave(() => editorStore.getState().addElement(createShapeElement()));
      return;
    case "nudge": {
      const delta = nudgeDelta(event.key, event.shiftKey);
      if (delta) mutateAndSave(() => editorStore.getState().moveSelected(delta));
    }
  }
}

export function useEditorKeyboardRouting(handlers: EditorKeyboardHandlers) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => routeEditorKeyDown(event, handlers);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}

export function useEditorEscapeRouting({
  dialog,
  localeDialogOpen,
  panel,
  overlay,
  inspectorOpen,
  setPanel,
  closeInspector,
}: {
  dialog: ResourceDialog | null;
  localeDialogOpen: boolean;
  panel: WorkspacePanel | null;
  overlay: boolean;
  inspectorOpen: boolean;
  setPanel: (panel: WorkspacePanel | null) => void;
  closeInspector: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape" || dialog || localeDialogOpen) return;
      if (panel === "add") setPanel("structure");
      else if (panel) setPanel(null);
      else if (overlay && inspectorOpen) closeInspector();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeInspector, dialog, inspectorOpen, localeDialogOpen, overlay, panel, setPanel]);
}
