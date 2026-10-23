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
  | "agent"
  | "export"
  | "toggle-view"
  | "prev-size"
  | "next-size";

export interface EditorKeyboardHandlers {
  onOpenDialog: (dialog: ResourceDialog) => void;
  onSearch: () => void;
  onToggleAgent: () => void;
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
  /** The physical key, e.g. `KeyZ`; it names a shortcut only where `key` has no Latin letter. */
  code: string;
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Focus is on a button or link, including dnd-kit's `role="button"` drag handles. */
  interactive: boolean;
  /** Focus is in a text field, select, or dialog, which own the keyboard. */
  ownsKeys: boolean;
  modalOpen: boolean;
  /** A non-modal menu is open and owns the keyboard (its arrows move between items). */
  menuOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  /** An agent run owns the project; only commands that change nothing still run. */
  editingLocked?: boolean;
}

const isPrintableAscii = (key: string) => /^[\x21-\x7e]$/.test(key);

/**
 * The letter a shortcut names. `key` wins, so AZERTY keeps Z on the Z key; a key with no Latin
 * letter (Cyrillic, "ü", "Dead") falls back to the physical key. Alt produces other characters
 * (Option+O is "ø"), so it never falls back.
 */
function shortcutLetter({ key, code, altKey }: Pick<EditorKeyboardInput, "key" | "code" | "altKey">): string {
  if (altKey || isPrintableAscii(key)) return key.toLowerCase();
  return /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : key.toLowerCase();
}

/** `[` or `]`, typed directly, by Option / AltGr (Alt, plus Ctrl on Windows), or on a non-Latin layout. */
function shortcutBracket(input: EditorKeyboardInput): "[" | "]" | null {
  if (input.metaKey || (input.ctrlKey && !input.altKey)) return null;
  if (input.key === "[" || input.key === "]") return input.key;
  if (isPrintableAscii(input.key)) return null;
  if (input.code === "BracketLeft") return "[";
  return input.code === "BracketRight" ? "]" : null;
}

// Search is left out: it opens the Layers panel, which is inert during a run.
const READ_ONLY_COMMANDS = new Set<EditorKeyboardCommand>(["agent", "toggle-view", "prev-size", "next-size"]);

export function resolveEditorKeyboardCommand(input: EditorKeyboardInput): EditorKeyboardCommand | null {
  const command = resolveCommand(input);
  return command && input.editingLocked && !READ_ONLY_COMMANDS.has(command) ? null : command;
}

function resolveCommand(input: EditorKeyboardInput): EditorKeyboardCommand | null {
  if (input.repeat || input.modalOpen || input.ownsKeys || input.menuOpen) return null;
  const letter = shortcutLetter(input);
  const modifier = input.metaKey || input.ctrlKey;
  // Chords and navigation keys also work while a button or link has focus.
  if (modifier && letter === "z") {
    if (input.shiftKey) return input.canRedo ? "redo" : null;
    return input.canUndo ? "undo" : null;
  }
  if (input.ctrlKey && letter === "y") return input.canRedo ? "redo" : null;
  if (modifier && letter === "g") return input.shiftKey ? "ungroup" : "group";
  if (modifier && letter === "d") return input.hasSelection ? "duplicate" : null;
  if (modifier && input.key === "/") return "templates";
  if (modifier && !input.shiftKey && !input.altKey) {
    if (letter === "k") return "search";
    if (letter === "j") return "agent";
    if (letter === "e") return "export";
  }
  const bracket = shortcutBracket(input);
  if (bracket) return bracket === "[" ? "prev-size" : "next-size";
  if (letter === "o" && !modifier && !input.altKey) return "toggle-view";
  // Arrows and Delete belong to tabs, radio groups, and sortable handles; T and R stay with them.
  if (input.interactive || modifier || input.altKey) return null;
  if (input.key === "Delete" || input.key === "Backspace") return input.hasSelection ? "delete" : null;
  if (nudgeDelta(input.key, false)) return input.hasSelection ? "nudge" : null;
  if (letter === "t") return "add-text";
  if (letter === "r") return "add-shape";
  return null;
}

const KEY_OWNING_TARGETS = "input, textarea, select, [role='dialog'], [contenteditable='true']";
const INTERACTIVE_TARGETS = "button, a, [role='button']";

function targetMatches(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

export function routeEditorKeyDown(event: KeyboardEvent, handlers: EditorKeyboardHandlers, editingLocked = false) {
  const state = editorStore.getState();
  const command = resolveEditorKeyboardCommand({
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    interactive: targetMatches(event.target, INTERACTIVE_TARGETS),
    ownsKeys: targetMatches(event.target, KEY_OWNING_TARGETS),
    modalOpen: Boolean(document.querySelector("[role='dialog'][aria-modal='true']")),
    menuOpen: Boolean(document.querySelector("[role='menu']:not([hidden])")),
    canUndo: state.historyPast.length > 0,
    canRedo: state.historyFuture.length > 0,
    hasSelection: state.selectedItems.length > 0,
    editingLocked,
  });
  if (!command) return;
  // Every routed command takes its key from the browser, e.g. Ctrl+K and Ctrl+E, which focus Chrome's
  // address bar on Windows and Linux.
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
    case "agent":
      handlers.onToggleAgent();
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

export function useEditorKeyboardRouting(handlers: EditorKeyboardHandlers, editingLocked = false) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => routeEditorKeyDown(event, handlers, editingLocked);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingLocked, handlers]);
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
