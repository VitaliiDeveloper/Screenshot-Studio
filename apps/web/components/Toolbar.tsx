// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  Download,
  LayoutGrid,
  Link2,
  Languages,
  PanelsTopLeft,
  PanelRight,
  Redo2,
  Scan,
  Undo2,
  X,
} from "lucide-react";
import { findOwnerOverflows } from "@screenshot-studio/core/model";
import type { WorkspaceView } from "../lib/editor-workspace";
import { editorStore } from "../lib/editor-store";
import { ExportDialog } from "./ExportDialog";
import { cx, DialogShell, editorUi, MenuSelect } from "./editor-ui";
import { mutateAndSave } from "../lib/mutate-and-save";

const EMPTY_LOCALES: string[] = [];

export function Toolbar({
  view,
  inspectorOpen,
  onViewChange,
  onToggleInspector,
  onOpenLocales,
}: {
  view: WorkspaceView;
  inspectorOpen: boolean;
  onViewChange: (view: WorkspaceView) => void;
  onToggleInspector: () => void;
  onOpenLocales: () => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [connectPromptOpen, setConnectPromptOpen] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const projectName = useStore(editorStore, (state) => state.project?.meta.name ?? "Untitled project");
  const locales = useStore(editorStore, (state) => state.project?.locales ?? EMPTY_LOCALES);
  const activeLocale = useStore(editorStore, (state) =>
    state.project?.screens.find((screen) => screen.id === state.activeScreenId)?.locale
      ?? state.project?.locales[0]
      ?? "",
  );
  const canUndo = useStore(editorStore, (state) => state.historyPast.length > 0);
  const canRedo = useStore(editorStore, (state) => state.historyFuture.length > 0);
  const canvasMode = useStore(editorStore, (state) => state.project?.mode ?? "isolated");
  const localeOptions = useMemo(
    () => locales.map((locale) => ({ value: locale, label: locale })),
    [locales],
  );

  useEffect(() => {
    if (!modeError) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setModeError(null);
    };
    document.addEventListener("keydown", dismiss, true);
    return () => document.removeEventListener("keydown", dismiss, true);
  }, [modeError]);

  return (
    <header className="relative flex min-h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 shadow-[0_1px_0_rgba(15,23,42,0.02)] sm:px-4">
      <div className="flex shrink-0 items-center gap-2.5">
        <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm shadow-blue-600/20 sm:inline-flex">
          <PanelsTopLeft size={16} strokeWidth={1.9} />
        </span>
        <span className="hidden whitespace-nowrap text-sm font-semibold tracking-tight text-slate-950 md:inline">Screenshot Studio</span>
        <span className="hidden h-5 w-px bg-slate-200 xl:block" aria-hidden="true" />
        <span className="hidden max-w-48 truncate whitespace-nowrap text-xs font-medium text-slate-600 xl:inline">{projectName}</span>
      </div>

      <div
        className="absolute left-1/2 flex -translate-x-1/2 items-center rounded-xl border border-slate-200 bg-slate-50 p-1"
        aria-label="Canvas view"
      >
        <button
          type="button"
          aria-label="Focus"
          aria-pressed={view === "focus"}
          title="Focus"
          className={cx(
            "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 lg:px-3",
            view === "focus" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800",
          )}
          onClick={() => onViewChange("focus")}
        >
          <Scan size={14} strokeWidth={1.9} /> <span className="hidden lg:inline">Focus</span>
        </button>
        <button
          type="button"
          aria-label="Overview"
          aria-pressed={view === "overview"}
          title="Overview"
          className={cx(
            "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 lg:px-3",
            view === "overview" ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800",
          )}
          onClick={() => onViewChange("overview")}
        >
          <LayoutGrid size={14} strokeWidth={1.9} /> <span className="hidden lg:inline">Overview</span>
        </button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <div className="hidden lg:contents">
          <button
            type="button"
            aria-label="Undo"
            title="Undo (⌘Z)"
            disabled={!canUndo}
            className={editorUi.iconButton}
            onClick={() => mutateAndSave(() => editorStore.getState().undo())}
          >
            <Undo2 size={15} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
            disabled={!canRedo}
            className={editorUi.iconButton}
            onClick={() => mutateAndSave(() => editorStore.getState().redo())}
          >
            <Redo2 size={15} strokeWidth={1.9} />
          </button>
        </div>
        <button
          type="button"
          aria-label={`Canvas mode: ${canvasMode}`}
          aria-pressed={canvasMode === "connected"}
          title={`${canvasMode === "connected" ? "Connected" : "Isolated"} canvas — switch to ${canvasMode === "connected" ? "isolated" : "connected"}`}
          className={cx(editorUi.iconButton, canvasMode === "connected" && "bg-blue-50 text-blue-700")}
          onClick={() => {
            setModeError(null);
            if (canvasMode === "isolated") {
              setConnectPromptOpen(true);
              return;
            }
            try {
              mutateAndSave(() => editorStore.getState().setCanvasMode("isolated"));
            } catch {
              const currentProject = editorStore.getState().project;
              const overflowCount = currentProject ? findOwnerOverflows(currentProject).length : 0;
              const subject = overflowCount === 1 ? "visible element extends" : `${overflowCount} visible elements extend`;
              setModeError(
                `Can't switch to isolated canvas yet. ${subject} beyond its screen boundaries. Move or resize ${overflowCount === 1 ? "it" : "them"} so each fits inside its own screen, then try again.`,
              );
            }
          }}
        >
          <Link2 size={15} strokeWidth={1.9} />
        </button>
        {activeLocale && localeOptions.length > 0 ? (
          <MenuSelect
            ariaLabel={`Active locale: ${activeLocale}`}
            menuLabel="Project locales"
            value={activeLocale}
            options={localeOptions}
            onChange={(locale) => editorStore.getState().selectLocale(locale)}
            className="w-16 sm:w-24"
            triggerClassName="h-8 px-2 font-semibold"
            menuClassName="w-32"
          />
        ) : null}
        <button type="button" aria-label="Manage locales" className={editorUi.iconButton} onClick={onOpenLocales}>
          <Languages size={15} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          aria-label="Inspect"
          aria-pressed={inspectorOpen}
          className={cx(editorUi.buttonGhost, inspectorOpen && "bg-slate-100 text-slate-900")}
          onClick={onToggleInspector}
        >
          <PanelRight size={15} strokeWidth={1.9} /> <span className="hidden lg:inline">Inspect</span>
        </button>
        <button type="button" aria-label="Export" title="Export" className={editorUi.buttonPrimary} onClick={() => setExportOpen(true)}>
          <Download size={15} strokeWidth={2} /> <span className="hidden lg:inline">Export</span>
        </button>
      </div>

      {modeError ? (
        <div role="alert" className="absolute right-3 top-[calc(100%+0.5rem)] z-50 flex max-w-[min(28rem,calc(100vw-1.5rem))] items-start gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs leading-5 text-amber-800 shadow-xl">
          <span className="min-w-0 flex-1">{modeError}</span>
          <button type="button" aria-label="Dismiss canvas mode error" className={editorUi.iconButton} onClick={() => setModeError(null)}>
            <X size={14} strokeWidth={1.9} />
          </button>
        </div>
      ) : null}

      {connectPromptOpen ? (
        <DialogShell
          title="Switch to connected canvas?"
          description="Connected canvas lets artwork continue across adjacent screens."
          widthClass="max-w-md"
          onClose={() => setConnectPromptOpen(false)}
        >
          <p className="text-sm leading-6 text-slate-600">
            This changes the whole project. Artwork outside a screen becomes visible on its neighbours.
            You can switch back to isolated canvas only after every visible element fits inside its own screen.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className={editorUi.buttonSecondary} onClick={() => setConnectPromptOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={editorUi.buttonPrimary}
              onClick={() => {
                mutateAndSave(() => editorStore.getState().setCanvasMode("connected"));
                setConnectPromptOpen(false);
              }}
            >
              Switch to connected
            </button>
          </div>
        </DialogShell>
      ) : null}

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </header>
  );
}
