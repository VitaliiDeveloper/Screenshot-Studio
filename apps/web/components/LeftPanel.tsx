"use client";

import { PanelsTopLeft } from "lucide-react";
import { ScreensSection } from "./ScreensSection";
import { LayersSection } from "./LayersSection";

/** The editor's left panel: Screens on top, Layers below (active screen). */
export function LeftPanel() {
  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white shadow-[1px_0_0_rgba(15,23,42,0.02)]">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3.5">
        <span className="inline-flex size-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-600/20">
          <PanelsTopLeft size={17} strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-slate-950">Screenshot Studio</p>
          <p className="text-[11px] text-slate-500">Project editor</p>
        </div>
      </div>
      <ScreensSection />
      <LayersSection />
    </aside>
  );
}
