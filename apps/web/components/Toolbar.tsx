"use client";

import { useState } from "react";
import { useStore } from "zustand";
import {
  Download,
  LayoutGrid,
  PanelsTopLeft,
  PanelRight,
  Scan,
} from "lucide-react";
import type { WorkspaceView } from "../lib/editor-workspace";
import { editorStore } from "../lib/editor-store";
import { ExportDialog } from "./ExportDialog";
import { cx, editorUi } from "./editor-ui";

export function Toolbar({
  view,
  inspectorOpen,
  onViewChange,
  onToggleInspector,
}: {
  view: WorkspaceView;
  inspectorOpen: boolean;
  onViewChange: (view: WorkspaceView) => void;
  onToggleInspector: () => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const projectName = useStore(editorStore, (state) => state.project?.meta.name ?? "Untitled project");

  return (
    <header className="flex min-h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 shadow-[0_1px_0_rgba(15,23,42,0.02)] sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm shadow-blue-600/20">
          <PanelsTopLeft size={16} strokeWidth={1.9} />
        </span>
        <span className="hidden text-sm font-semibold tracking-tight text-slate-950 sm:inline">Screenshot Studio</span>
        <span className="hidden h-5 w-px bg-slate-200 md:block" aria-hidden="true" />
        <span className="hidden max-w-48 truncate text-xs font-medium text-slate-600 md:inline">{projectName}</span>
      </div>

      <div className="mx-auto flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="Canvas view">
        <button
          type="button"
          aria-label="Focus"
          aria-pressed={view === "focus"}
          className={cx(
            "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 sm:px-3",
            view === "focus" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800",
          )}
          onClick={() => onViewChange("focus")}
        >
          <Scan size={14} strokeWidth={1.9} /> <span className="hidden sm:inline">Focus</span>
        </button>
        <button
          type="button"
          aria-label="Overview"
          aria-pressed={view === "overview"}
          className={cx(
            "inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 sm:px-3",
            view === "overview" ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800",
          )}
          onClick={() => onViewChange("overview")}
        >
          <LayoutGrid size={14} strokeWidth={1.9} /> <span className="hidden sm:inline">Overview</span>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          aria-label="Inspect"
          aria-pressed={inspectorOpen}
          className={cx(editorUi.buttonGhost, inspectorOpen && "bg-slate-100 text-slate-900")}
          onClick={onToggleInspector}
        >
          <PanelRight size={15} strokeWidth={1.9} /> <span className="hidden lg:inline">Inspect</span>
        </button>
        <button type="button" aria-label="Export" className={editorUi.buttonPrimary} onClick={() => setExportOpen(true)}>
          <Download size={15} strokeWidth={2} /> <span className="hidden sm:inline">Export</span>
        </button>
      </div>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </header>
  );
}
