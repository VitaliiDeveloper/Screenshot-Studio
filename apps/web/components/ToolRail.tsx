// SPDX-License-Identifier: Apache-2.0
"use client";

import {
  Hand,
  House,
  Languages,
  Layers3,
  LayoutTemplate,
  LoaderCircle,
  MousePointer2,
  Palette,
  Type,
} from "lucide-react";
import type { ResourceDialog, WorkspacePanel, WorkspaceTool } from "@web/lib/editor-workspace";
import { ToolButton } from "./editor-ui";

export function ToolRail({
  tool,
  panel,
  onToolChange,
  onPanelToggle,
  onOpenDialog,
  onOpenLocales,
  onOpenProjects,
  projectsBusy,
}: {
  tool: WorkspaceTool;
  panel: WorkspacePanel | null;
  onToolChange: (tool: WorkspaceTool) => void;
  onPanelToggle: (panel: WorkspacePanel) => void;
  onOpenDialog: (dialog: ResourceDialog) => void;
  onOpenLocales: () => void;
  onOpenProjects: () => void;
  projectsBusy: boolean;
}) {
  return (
    <nav
      aria-label="Editor tools"
      className="z-40 flex h-full w-15 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white px-1.5 py-3"
    >
      <ToolButton
        label="Select tool"
        active={tool === "select"}
        variant="tool"
        onClick={() => onToolChange("select")}
      >
        <MousePointer2 size={18} strokeWidth={1.9} />
      </ToolButton>
      <ToolButton
        label="Hand tool"
        active={tool === "hand"}
        variant="tool"
        onClick={() => onToolChange("hand")}
      >
        <Hand size={18} strokeWidth={1.9} />
      </ToolButton>

      <span className="my-2 h-px w-7 bg-slate-200" aria-hidden="true" />

      <ToolButton
        label="Layers panel"
        active={panel === "structure"}
        variant="panel"
        onClick={() => onPanelToggle("structure")}
      >
        <Layers3 size={18} strokeWidth={1.9} />
      </ToolButton>
      <ToolButton label="Screen templates" variant="panel" aria-haspopup="dialog" onClick={() => onOpenDialog("templates")}>
        <LayoutTemplate size={18} strokeWidth={1.9} />
      </ToolButton>
      <ToolButton label="Design packs" variant="panel" aria-haspopup="dialog" onClick={() => onOpenDialog("themes")}>
        <Palette size={18} strokeWidth={1.9} />
      </ToolButton>
      <ToolButton label="Fonts" variant="panel" aria-haspopup="dialog" onClick={() => onOpenDialog("fonts")}>
        <Type size={18} strokeWidth={1.9} />
      </ToolButton>
      <ToolButton label="Locales" variant="panel" aria-haspopup="dialog" onClick={onOpenLocales}>
        <Languages size={18} strokeWidth={1.9} />
      </ToolButton>

      <button
        type="button"
        aria-label="Projects"
        title="Projects"
        disabled={projectsBusy}
        onClick={onOpenProjects}
        className="mt-auto grid size-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 disabled:cursor-wait disabled:opacity-60"
      >
        {projectsBusy
          ? <LoaderCircle aria-hidden="true" className="size-[18px] animate-spin motion-reduce:animate-none" />
          : <House aria-hidden="true" size={18} strokeWidth={1.9} />}
      </button>

    </nav>
  );
}
