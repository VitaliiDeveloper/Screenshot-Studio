// SPDX-License-Identifier: Apache-2.0
"use client";

import { useStore } from "zustand";
import { findElementLocation } from "@screenshot-studio/core/model";
import { editorStore, type EditorState } from "@web/lib/editor/editor-store";
import { elementLabel, elementTypeLabel, selectionTypeSummary } from "@web/lib/panel-helpers";
import { cx } from "@web/components/editor-ui";

export type SaveTone = "idle" | "busy" | "error";

/** `14:02` in the viewer's locale; the zone and locale are parameters only so tests are stable. */
export function savedTimeLabel(savedAt: number, locale?: string, timeZone?: string): string {
  return new Date(savedAt).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone });
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
      return { text: "Saved", savedAt: lastSavedAt, tone: "idle" };
    case "error":
      return lastSavedAt === null
        ? { text: "Save failed · nothing saved yet", savedAt: null, tone: "error" }
        : { text: "Save failed · last saved", savedAt: lastSavedAt, tone: "error" };
    case "idle":
      return { text: "No unsaved changes", savedAt: null, tone: "idle" };
  }
}

/** The active screen and what is selected on it, e.g. `Hero · Hero headline (Text)`. */
export function selectionStatus(
  state: Pick<EditorState, "project" | "activeLayoutId" | "activeScreenId" | "selectedItems">,
): string {
  const layout = state.project?.layouts.find((candidate) => candidate.id === state.activeLayoutId);
  const screen = layout?.screens.find((candidate) => candidate.id === state.activeScreenId);
  if (!layout || !screen) return "";
  const elements = state.selectedItems.flatMap((item) => {
    const owner = layout.screens.find((candidate) => candidate.id === item.screenId);
    const location = owner ? findElementLocation(owner, item.elementId) : null;
    return location ? [location.element] : [];
  });
  if (elements.length === 0) return `${screen.name} · No layer selected`;
  if (elements.length > 1) {
    return `${screen.name} · ${elements.length} layers (${selectionTypeSummary(elements)})`;
  }
  const label = elementLabel(elements[0]!);
  const type = elementTypeLabel(elements[0]!.type);
  return `${screen.name} · ${label === type ? label : `${label} (${type})`}`;
}

const HINTS = [
  { keys: "[ ]", action: "Size" },
  { keys: "O", action: "View" },
  { keys: "⌘K", action: "Find" },
  { keys: "⌘Z", action: "Undo" },
] as const;

const toneClass: Record<SaveTone, string> = {
  idle: "bg-[var(--editor-color-text-secondary)]",
  busy: "bg-[var(--editor-color-accent)]",
  error: "bg-[var(--editor-color-danger)]",
};

/** The 34 px strip under the Workspace: save state, the current selection, and key hints. */
export function StatusBar() {
  const saveStatus = useStore(editorStore, (state) => state.saveStatus);
  const lastSavedAt = useStore(editorStore, (state) => state.lastSavedAt);
  const selection = useStore(editorStore, selectionStatus);
  const save = saveStatusParts(saveStatus, lastSavedAt);

  return (
    <footer
      data-testid="status-bar"
      className="flex h-[34px] shrink-0 items-center gap-4 border-t border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-3 text-[11px] text-[color:var(--editor-color-text-muted)]"
    >
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
            <kbd className="rounded border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] px-1 font-sans text-[10px] font-medium text-[color:var(--editor-color-text-default)]">
              {keys}
            </kbd>
            <span>{action}</span>
          </li>
        ))}
      </ul>
    </footer>
  );
}
