// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { ArrowLeftRight, Check, ChevronDown, Copy, LayoutTemplate, MoreVertical, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { findOwnerOverflows, type CanvasMode, type DesignLayout, type Project } from "@screenshot-studio/core/model";
import { editorStore, selectEditorLayout } from "@web/lib/editor/editor-store";
import { LAYOUT_MODE_LABELS } from "@web/lib/layout-mode-labels";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";
import { ConfirmationDialog, cx, DialogShell, editorUi, SegmentedControl } from "./editor-ui";

const actionMenuItem = "flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium text-[color:var(--editor-color-text-default)] transition-colors hover:bg-[var(--editor-color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)] disabled:pointer-events-none disabled:opacity-45";

function nextCopyName(project: Project, source: DesignLayout): string {
  const names = new Set(project.layouts.map((layout) => layout.name.toLocaleLowerCase()));
  let index = 1;
  while (true) {
    const candidate = index === 1 ? `${source.name} Copy` : `${source.name} Copy ${index}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
    index += 1;
  }
}

export function layoutDeleteConfirmation(project: Project, layout: DesignLayout): string {
  const base = `Delete layout "${layout.name}"?`;
  if (project.preferredExportLayoutId !== layout.id) return base;
  const index = project.layouts.findIndex((candidate) => candidate.id === layout.id);
  const replacement = project.layouts[index + 1] ?? project.layouts[index - 1];
  return replacement
    ? `${base} "${replacement.name}" will become the preferred export layout.`
    : base;
}

export function layoutPresentation(project: Project, layout: DesignLayout, activeLayoutId: string) {
  const preferred = project.preferredExportLayoutId === layout.id;
  return {
    active: activeLayoutId === layout.id,
    preferred,
    preferredIndicator: preferred ? "subtitle" as const : null,
    showActions: true,
    subtitle: preferred ? "Preferred for export" : null,
  };
}

export interface LayoutMenuState {
  open: boolean;
  actionMenuId: string | null;
}

const CLOSED_LAYOUT_MENU: LayoutMenuState = { open: false, actionMenuId: null };

export function toggleLayoutMenuState(state: LayoutMenuState): LayoutMenuState {
  return state.open ? CLOSED_LAYOUT_MENU : { open: true, actionMenuId: null };
}

export function layoutActionPresentation(
  project: Project,
  layout: DesignLayout,
  includeModeWarning = false,
) {
  const nextMode: CanvasMode = layout.mode === "connected" ? "isolated" : "connected";
  const overflowCount = includeModeWarning && nextMode === "isolated"
    ? findOwnerOverflows(project, layout.id).length
    : 0;
  const modeWarning = overflowCount === 1
    ? "1 element extends outside its owner artboard and will be clipped in Separate images mode. Layout data remains unchanged."
    : overflowCount > 1
      ? `${overflowCount} elements extend outside their owner artboards and will be clipped in Separate images mode. Layout data remains unchanged.`
      : null;
  return {
    canDelete: project.layouts.length > 1,
    canPrefer: project.preferredExportLayoutId !== layout.id,
    nextMode,
    switchModeLabel: `Switch to ${LAYOUT_MODE_LABELS[nextMode]}`,
    modeWarning,
  };
}

export function LayoutSelector() {
  const project = useStore(editorStore, (state) => state.project);
  const activeLayout = useStore(editorStore, selectEditorLayout);
  const [menuState, setMenuState] = useState<LayoutMenuState>(CLOSED_LAYOUT_MENU);
  const [dialog, setDialog] = useState<"create" | "rename" | null>(null);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<CanvasMode>("isolated");
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteLayout, setPendingDeleteLayout] = useState<DesignLayout | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, actionMenuId } = menuState;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuState(CLOSED_LAYOUT_MENU);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuState(CLOSED_LAYOUT_MENU);
      queueMicrotask(() => triggerRef.current?.focus());
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  if (!project || !activeLayout) return null;

  const beginCreate = () => {
    setName("");
    setMode("isolated");
    setError(null);
    setDialog("create");
    setMenuState(CLOSED_LAYOUT_MENU);
  };
  const beginRename = (layout: DesignLayout) => {
    setRenameTargetId(layout.id);
    setName(layout.name);
    setError(null);
    setDialog("rename");
    setMenuState(CLOSED_LAYOUT_MENU);
  };
  const submit = () => {
    try {
      if (dialog === "create") {
        mutateAndSave(() => editorStore.getState().addLayout(name, mode));
      } else if (renameTargetId) {
        mutateAndSave(() => editorStore.getState().renameLayout(renameTargetId, name));
      }
      setDialog(null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  return (
    <>
      <div ref={rootRef} className="relative size-9 shrink-0 sm:h-10 sm:w-auto sm:max-w-80 sm:min-w-0 sm:flex-1">
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Active layout: ${activeLayout.name}`}
          className="inline-flex size-9 items-center justify-center rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-0 text-sm font-medium text-[color:var(--editor-color-text)] shadow-sm transition-colors hover:border-[var(--editor-color-border-strong)] hover:bg-[var(--editor-color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] sm:h-10 sm:w-full sm:min-w-0 sm:justify-between sm:gap-3 sm:px-4"
          onClick={() => setMenuState(toggleLayoutMenuState)}
        >
          <LayoutTemplate size={14} className="sm:hidden" aria-hidden="true" />
          <span className="hidden min-w-0 flex-1 items-center gap-2 text-left sm:flex">
            <span className="truncate text-[13px] font-semibold">{activeLayout.name}</span>
            <span className={cx(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              activeLayout.mode === "connected" ? "bg-[var(--editor-color-accent-subtle)] text-[color:var(--editor-color-accent-text-strong)]" : "bg-[var(--editor-color-surface-muted)] text-[color:var(--editor-color-text-muted)]",
            )}>
              {LAYOUT_MODE_LABELS[activeLayout.mode]}
            </span>
          </span>
          <ChevronDown size={14} className={cx("hidden shrink-0 text-[color:var(--editor-color-accent-text)] transition-transform sm:block", open && "rotate-180")} aria-hidden="true" />
        </button>

        {open ? (
          <div role="menu" aria-label="Design layouts" className="absolute left-0 top-[calc(100%+0.45rem)] z-50 w-[22rem] overflow-visible rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-4 shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
            <div className="max-h-80 overflow-visible">
              {project.layouts.map((layout) => {
                const presentation = layoutPresentation(project, layout, activeLayout.id);
                const actions = layoutActionPresentation(project, layout, actionMenuId === layout.id);
                return (
                  <div key={layout.id} className="group relative flex items-center border-b border-[var(--editor-color-border-subtle)] py-1.5 last:border-b-0">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={presentation.active}
                      className={cx(
                        "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--editor-color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]",
                        presentation.active && "bg-[var(--editor-color-accent-subtle)]",
                      )}
                      onClick={() => {
                        editorStore.getState().selectLayout(layout.id);
                        setMenuState(CLOSED_LAYOUT_MENU);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cx("truncate text-sm text-[color:var(--editor-color-text-strong)]", presentation.active ? "font-semibold" : "font-medium")}>{layout.name}</span>
                          <span className={cx(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            layout.mode === "connected" ? "bg-[var(--editor-color-accent-subtle)] text-[color:var(--editor-color-accent-text-strong)]" : "bg-[var(--editor-color-surface-muted)] text-[color:var(--editor-color-text-muted)]",
                          )}>{LAYOUT_MODE_LABELS[layout.mode]}</span>
                        </span>
                        {presentation.subtitle ? (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-[color:var(--editor-color-text-secondary)]">
                            {presentation.preferredIndicator === "subtitle" ? <Star size={11} className="fill-[var(--editor-color-accent)] text-[color:var(--editor-color-accent-text)]" aria-hidden="true" /> : null}
                            {presentation.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {presentation.active ? (
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--editor-color-accent)] text-[color:var(--editor-color-on-accent)]" aria-label="Selected layout">
                          <Check size={14} strokeWidth={2.4} aria-hidden="true" />
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      aria-label={`More actions for ${layout.name}`}
                      aria-haspopup="menu"
                      aria-expanded={actionMenuId === layout.id}
                      className={cx(editorUi.compactIconButton, "ml-1 shrink-0", !presentation.showActions && "hidden")}
                      onClick={() => setMenuState((current) => ({
                        open: true,
                        actionMenuId: current.actionMenuId === layout.id ? null : layout.id,
                      }))}
                    ><MoreVertical size={15} /></button>
                    {actionMenuId === layout.id ? (
                      <div role="menu" aria-label={`Actions for ${layout.name}`} className="absolute right-0 top-[calc(100%-0.25rem)] z-10 w-48 rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-1.5 shadow-xl">
                        <button type="button" role="menuitem" className={actionMenuItem} onClick={() => beginRename(layout)}><Pencil size={13} /> Rename</button>
                        <button type="button" role="menuitem" className={actionMenuItem} onClick={() => {
                          mutateAndSave(() => editorStore.getState().duplicateLayout(layout.id, nextCopyName(project, layout)));
                          setMenuState(CLOSED_LAYOUT_MENU);
                        }}><Copy size={13} /> Duplicate</button>
                        <button type="button" role="menuitem" className={actionMenuItem} onClick={() => {
                          mutateAndSave(() => editorStore.getState().setLayoutMode(layout.id, actions.nextMode));
                          setMenuState(CLOSED_LAYOUT_MENU);
                        }}>
                          <ArrowLeftRight size={13} className="shrink-0" />
                          <span className="min-w-0 py-1">
                            <span className="block">{actions.switchModeLabel}</span>
                            {actions.modeWarning ? (
                              <span className="mt-0.5 block text-[10px] font-normal leading-4 text-[color:var(--editor-color-warning-text)]">
                                {actions.modeWarning}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <button type="button" role="menuitem" disabled={!actions.canPrefer} className={actionMenuItem} onClick={() => {
                          mutateAndSave(() => editorStore.getState().preferLayout(layout.id));
                          setMenuState((current) => ({ ...current, actionMenuId: null }));
                        }}><Star size={13} /> Prefer for export</button>
                        <button type="button" role="menuitem" disabled={!actions.canDelete} className={cx(actionMenuItem, "text-[color:var(--editor-color-danger-text)] hover:bg-[var(--editor-color-danger-surface)] hover:text-[color:var(--editor-color-danger-text)]")} onClick={() => {
                          setMenuState(CLOSED_LAYOUT_MENU);
                          setPendingDeleteLayout(layout);
                        }}><Trash2 size={13} /> Delete</button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button type="button" role="menuitem" className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-xl border border-[var(--editor-color-border)] px-4 py-2 text-sm font-medium text-[color:var(--editor-color-text-default)] transition-colors hover:border-[var(--editor-color-accent-border)] hover:bg-[var(--editor-color-accent-subtle)] hover:text-[color:var(--editor-color-accent-text-strong)]" onClick={beginCreate}>
              <Plus size={18} className="text-[color:var(--editor-color-accent-text)]" /> Create layout
            </button>
          </div>
        ) : null}
      </div>

      {dialog ? (
        <DialogShell
          title={dialog === "create" ? "Create layout" : "Rename layout"}
          description={dialog === "create" ? "Start with one clean screen using the active screen dimensions." : "Layout names must be unique."}
          widthClass="max-w-sm"
          onClose={() => setDialog(null)}
        >
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-[color:var(--editor-color-text-muted)]">
              Name
              <input className={editorUi.field} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            {dialog === "create" ? (
              <div className="flex flex-col gap-1 text-xs font-medium text-[color:var(--editor-color-text-muted)]">
                <span>Mode</span>
                <SegmentedControl<CanvasMode>
                  label="Layout mode"
                  value={mode}
                  options={[
                    { value: "isolated", label: LAYOUT_MODE_LABELS.isolated },
                    { value: "connected", label: LAYOUT_MODE_LABELS.connected },
                  ]}
                  fill
                  onChange={setMode}
                />
              </div>
            ) : null}
            {error ? <p role="alert" className={editorUi.statusError}>{error}</p> : null}
            <div className="mt-2 flex justify-end gap-2 border-t border-[var(--editor-color-border-subtle)] pt-4">
              <button type="button" className={editorUi.buttonSecondary} onClick={() => setDialog(null)}>Cancel</button>
              <button type="button" className={editorUi.buttonPrimary} disabled={!name.trim()} onClick={submit}>
                {dialog === "create" ? "Create" : "Rename"}
              </button>
            </div>
          </div>
        </DialogShell>
      ) : null}
      {pendingDeleteLayout ? (
        <ConfirmationDialog
          title="Delete layout?"
          description={layoutDeleteConfirmation(project, pendingDeleteLayout)}
          confirmLabel="Delete layout"
          onClose={() => setPendingDeleteLayout(null)}
          onConfirm={() => {
            const layoutId = pendingDeleteLayout.id;
            setPendingDeleteLayout(null);
            mutateAndSave(() => editorStore.getState().removeLayout(layoutId));
          }}
        />
      ) : null}
    </>
  );
}
