// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { ArrowLeftRight, Check, ChevronDown, Copy, LayoutTemplate, MoreVertical, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { CanvasMode, DesignLayout, Project } from "@screenshot-studio/core/model";
import { editorStore, selectEditorLayout } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { cx, DialogShell, editorUi } from "./editor-ui";

const actionMenuItem = "flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60 disabled:pointer-events-none disabled:opacity-45";

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

export function layoutActionPresentation(project: Project, layout: DesignLayout) {
  const nextMode: CanvasMode = layout.mode === "connected" ? "isolated" : "connected";
  return {
    canDelete: project.layouts.length > 1,
    canPrefer: project.preferredExportLayoutId !== layout.id,
    nextMode,
    switchModeLabel: `Switch to ${nextMode}`,
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
          className="inline-flex size-9 items-center justify-center rounded-xl border border-slate-200 bg-white p-0 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 sm:h-10 sm:w-full sm:min-w-0 sm:justify-between sm:gap-3 sm:px-4"
          onClick={() => setMenuState(toggleLayoutMenuState)}
        >
          <LayoutTemplate size={14} className="sm:hidden" aria-hidden="true" />
          <span className="hidden min-w-0 flex-1 items-center gap-2 text-left sm:flex">
            <span className="truncate text-[13px] font-semibold">{activeLayout.name}</span>
            <span className={cx(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
              activeLayout.mode === "connected" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600",
            )}>
              {activeLayout.mode}
            </span>
          </span>
          <ChevronDown size={14} className={cx("hidden shrink-0 text-blue-600 transition-transform sm:block", open && "rotate-180")} aria-hidden="true" />
        </button>

        {open ? (
          <div role="menu" aria-label="Design layouts" className="absolute left-0 top-[calc(100%+0.45rem)] z-50 w-[22rem] overflow-visible rounded-xl border border-slate-200 bg-white p-4 shadow-[0_18px_45px_rgba(15,23,42,0.16)]">
            <div className="max-h-80 overflow-visible">
              {project.layouts.map((layout) => {
                const presentation = layoutPresentation(project, layout, activeLayout.id);
                const actions = layoutActionPresentation(project, layout);
                return (
                  <div key={layout.id} className="group relative flex items-center border-b border-slate-100 py-1.5 last:border-b-0">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={presentation.active}
                      className={cx(
                        "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60",
                        presentation.active && "bg-blue-50/70",
                      )}
                      onClick={() => {
                        editorStore.getState().selectLayout(layout.id);
                        setMenuState(CLOSED_LAYOUT_MENU);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cx("truncate text-sm text-slate-900", presentation.active ? "font-semibold" : "font-medium")}>{layout.name}</span>
                          <span className={cx(
                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize",
                            layout.mode === "connected" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600",
                          )}>{layout.mode}</span>
                        </span>
                        {presentation.subtitle ? (
                          <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                            {presentation.preferredIndicator === "subtitle" ? <Star size={11} className="fill-blue-600 text-blue-600" aria-hidden="true" /> : null}
                            {presentation.subtitle}
                          </span>
                        ) : null}
                      </span>
                      {presentation.active ? (
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white" aria-label="Selected layout">
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
                      <div role="menu" aria-label={`Actions for ${layout.name}`} className="absolute right-0 top-[calc(100%-0.25rem)] z-10 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                        <button type="button" role="menuitem" className={actionMenuItem} onClick={() => beginRename(layout)}><Pencil size={13} /> Rename</button>
                        <button type="button" role="menuitem" className={actionMenuItem} onClick={() => {
                          mutateAndSave(() => editorStore.getState().duplicateLayout(layout.id, nextCopyName(project, layout)));
                          setMenuState(CLOSED_LAYOUT_MENU);
                        }}><Copy size={13} /> Duplicate</button>
                        <button type="button" role="menuitem" className={actionMenuItem} onClick={() => {
                          mutateAndSave(() => editorStore.getState().setLayoutMode(layout.id, actions.nextMode));
                          setMenuState(CLOSED_LAYOUT_MENU);
                        }}><ArrowLeftRight size={13} /> {actions.switchModeLabel}</button>
                        <button type="button" role="menuitem" disabled={!actions.canPrefer} className={actionMenuItem} onClick={() => {
                          mutateAndSave(() => editorStore.getState().preferLayout(layout.id));
                          setMenuState((current) => ({ ...current, actionMenuId: null }));
                        }}><Star size={13} /> Prefer for export</button>
                        <button type="button" role="menuitem" disabled={!actions.canDelete} className={cx(actionMenuItem, "text-red-600 hover:bg-red-50 hover:text-red-700")} onClick={() => {
                          if (!window.confirm(layoutDeleteConfirmation(project, layout))) return;
                          mutateAndSave(() => editorStore.getState().removeLayout(layout.id));
                          setMenuState(CLOSED_LAYOUT_MENU);
                        }}><Trash2 size={13} /> Delete</button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button type="button" role="menuitem" className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700" onClick={beginCreate}>
              <Plus size={18} className="text-blue-600" /> Create layout
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
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Name
              <input className={editorUi.field} autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            {dialog === "create" ? (
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Mode
                <select className={editorUi.field} value={mode} onChange={(event) => setMode(event.target.value as CanvasMode)}>
                  <option value="isolated">Isolated</option>
                  <option value="connected">Connected</option>
                </select>
              </label>
            ) : null}
            {error ? <p role="alert" className={editorUi.statusError}>{error}</p> : null}
            <div className="mt-2 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <button type="button" className={editorUi.buttonSecondary} onClick={() => setDialog(null)}>Cancel</button>
              <button type="button" className={editorUi.buttonPrimary} disabled={!name.trim()} onClick={submit}>
                {dialog === "create" ? "Create" : "Rename"}
              </button>
            </div>
          </div>
        </DialogShell>
      ) : null}
    </>
  );
}
