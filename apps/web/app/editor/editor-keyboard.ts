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
  | "nudge";

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
  modalOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
}

export function resolveEditorKeyboardCommand(input: EditorKeyboardInput): EditorKeyboardCommand | null {
  if (input.repeat || input.interactive || input.modalOpen) return null;
  const key = input.key.toLowerCase();
  const modifier = input.metaKey || input.ctrlKey;
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
  if (nudgeDelta(input.key, false)) return input.hasSelection ? "nudge" : null;
  if (key === "t") return "add-text";
  if (key === "r") return "add-shape";
  return null;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, button, a, [role='dialog'], [contenteditable='true']"));
}

export function useEditorKeyboardRouting(onOpenDialog: (dialog: ResourceDialog) => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = editorStore.getState();
      const command = resolveEditorKeyboardCommand({
        key: event.key,
        repeat: event.repeat,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        interactive: isInteractiveTarget(event.target),
        modalOpen: Boolean(document.querySelector("[role='dialog'][aria-modal='true']")),
        canUndo: state.historyPast.length > 0,
        canRedo: state.historyFuture.length > 0,
        hasSelection: state.selectedItems.length > 0,
      });
      if (!command) return;
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
          onOpenDialog("templates");
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
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenDialog]);
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
