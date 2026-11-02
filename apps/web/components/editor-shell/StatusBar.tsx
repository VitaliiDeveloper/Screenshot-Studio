// SPDX-License-Identifier: Apache-2.0
"use client";

import { useStore } from "zustand";
import { Redo2, Undo2 } from "lucide-react";
import { findElementLocation } from "@screenshot-studio/core/model";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { editorStore, selectEditorLayout, type EditorState } from "@web/lib/editor/editor-store";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";
import { compactScreenSizeLabel, elementLabel, selectionTypeSummary } from "@web/lib/panel-helpers";
import { cx, editorUi } from "@web/components/editor-ui";

type SaveTone = "idle" | "busy" | "error";

/** The time of a save in the viewer's locale, e.g. `12:04`. */
export function savedTimeLabel(savedAt: number): string {
  return new Date(savedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** The save cell's words; after a failure it still names the last time the project reached disk. */
export function saveStatusParts(
  status: EditorState["saveStatus"],
  lastSavedAt: number | null,
): { text: string; savedAt: number | null; tone: SaveTone } {
  switch (status) {
    case "saving":
      return { text: "Saving…", savedAt: null, tone: "busy" };
    case "saved":
      return { text: "Saved ·", savedAt: lastSavedAt, tone: "idle" };
    case "error":
      return lastSavedAt === null
        ? { text: "Save failed · nothing saved yet", savedAt: null, tone: "error" }
        : { text: "Save failed · last saved", savedAt: lastSavedAt, tone: "error" };
    case "idle":
      return { text: "No unsaved changes", savedAt: null, tone: "idle" };
  }
}

/** Screen, selection, and size, e.g. `Save Fast · Save fast headline · iPhone Dynamic Island · Medium`. */
export function selectionStatus(
  state: Pick<EditorState, "project" | "activeLayoutId" | "activeScreenId" | "selectedItems">,
  specs: StoreSpecs,
): string {
  const layout = selectEditorLayout(state);
  const screen = layout?.screens.find((candidate) => candidate.id === state.activeScreenId);
  if (!layout || !screen) return "";
  const elements = state.selectedItems.flatMap((item) => {
    const owner = layout.screens.find((candidate) => candidate.id === item.screenId);
    const location = owner ? findElementLocation(owner, item.elementId) : null;
    return location ? [location.element] : [];
  });
  const selected = elements.length === 0
    ? "No layer selected"
    : elements.length === 1
      ? elementLabel(elements[0]!)
      : `${elements.length} layers (${selectionTypeSummary(elements)})`;
  return [screen.name, selected, compactScreenSizeLabel(screen, specs)].join(" · ");
}

const HINTS = [
  { keys: "[ ]", action: "Size" },
  { keys: "O", action: "Focus/Overview" },
  { keys: "⌘K", action: "Find" },
  { keys: "⌘Z", action: "Undo" },
  { keys: "⇧⌘Z", action: "Redo" },
] as const;

const toneClass: Record<SaveTone, string> = {
  idle: "bg-[var(--editor-color-text-secondary)]",
  busy: "bg-[var(--editor-color-accent)]",
  error: "bg-[var(--editor-color-danger)]",
};

/** The 34 px strip under the Workspace: undo/redo, save state, the current selection, and key hints. */
export function StatusBar({ specs, editingLocked = false }: {
  specs: StoreSpecs;
  /** An agent run owns the project, so Undo and Redo wait for it. */
  editingLocked?: boolean;
}) {
  const saveStatus = useStore(editorStore, (state) => state.saveStatus);
  const lastSavedAt = useStore(editorStore, (state) => state.lastSavedAt);
  const selection = useStore(editorStore, (state) => selectionStatus(state, specs));
  const canUndo = useStore(editorStore, (state) => state.historyPast.length > 0) && !editingLocked;
  const canRedo = useStore(editorStore, (state) => state.historyFuture.length > 0) && !editingLocked;
  const save = saveStatusParts(saveStatus, lastSavedAt);

  return (
    <footer
      data-testid="status-bar"
      className="flex h-[34px] shrink-0 items-center gap-4 border-t border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] px-3 text-[11px] text-[color:var(--editor-color-text-secondary)]"
    >
      <div className="-ml-1.5 flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label="Undo"
          title="Undo (⌘Z)"
          disabled={!canUndo}
          className={editorUi.compactIconButton}
          onClick={() => mutateAndSave(() => editorStore.getState().undo())}
        >
          <Undo2 size={14} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo (⇧⌘Z)"
          disabled={!canRedo}
          className={editorUi.compactIconButton}
          onClick={() => mutateAndSave(() => editorStore.getState().redo())}
        >
          <Redo2 size={14} strokeWidth={1.9} />
        </button>
      </div>
      <p
        data-save-status={saveStatus}
        className={cx(
          "flex shrink-0 items-center gap-1.5",
          save.tone === "error" && "font-medium text-[color:var(--editor-color-danger-text)]",
        )}
      >
        <span aria-hidden="true" className={cx("size-1.5 rounded-full", toneClass[save.tone])} />
        <span>{save.text}</span>
        {save.savedAt !== null ? (
          <time dateTime={new Date(save.savedAt).toISOString()}>{savedTimeLabel(save.savedAt)}</time>
        ) : null}
      </p>
      <p data-testid="status-selection" className="min-w-0 flex-1 truncate">{selection}</p>
      <ul aria-label="Keyboard shortcuts" className="hidden shrink-0 items-center gap-3 md:flex">
        {HINTS.map(({ keys, action }) => (
          <li key={keys} className="flex items-center gap-1">
            <kbd className="rounded border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-1 font-sans text-[10px] font-medium text-[color:var(--editor-color-text-default)]">
              {keys}
            </kbd>
            <span>{action}</span>
          </li>
        ))}
      </ul>
    </footer>
  );
}
