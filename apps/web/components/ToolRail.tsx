"use client";

import {
  Boxes,
  Hand,
  Layers3,
  MousePointer2,
  Plus,
} from "lucide-react";
import type { WorkspacePanel, WorkspaceTool } from "../lib/editor-workspace";
import { cx } from "./editor-ui";

const toolButton =
  "inline-flex size-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70";

export function ToolRail({
  tool,
  panel,
  onToolChange,
  onPanelToggle,
}: {
  tool: WorkspaceTool;
  panel: WorkspacePanel | null;
  onToolChange: (tool: WorkspaceTool) => void;
  onPanelToggle: (panel: WorkspacePanel) => void;
}) {
  const toolClass = (active: boolean) => cx(
    toolButton,
    active && "bg-blue-600 text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 hover:text-white",
  );
  const panelClass = (active: boolean) => cx(
    toolButton,
    active && "bg-blue-50 text-blue-700 ring-1 ring-blue-100 hover:bg-blue-100 hover:text-blue-800",
  );

  return (
    <nav
      aria-label="Editor tools"
      className="z-40 flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white px-1.5 py-3"
    >
      <button
        type="button"
        aria-label="Select tool"
        aria-pressed={tool === "select"}
        className={toolClass(tool === "select")}
        onClick={() => onToolChange("select")}
      >
        <MousePointer2 size={18} strokeWidth={1.9} />
      </button>
      <button
        type="button"
        aria-label="Hand tool"
        aria-pressed={tool === "hand"}
        className={toolClass(tool === "hand")}
        onClick={() => onToolChange("hand")}
      >
        <Hand size={18} strokeWidth={1.9} />
      </button>

      <span className="my-2 h-px w-7 bg-slate-200" aria-hidden="true" />

      <button
        type="button"
        aria-label="Structure panel"
        aria-pressed={panel === "structure"}
        className={panelClass(panel === "structure")}
        onClick={() => onPanelToggle("structure")}
      >
        <Layers3 size={18} strokeWidth={1.9} />
      </button>
      <button
        type="button"
        aria-label="Resources panel"
        aria-pressed={panel === "resources"}
        className={panelClass(panel === "resources")}
        onClick={() => onPanelToggle("resources")}
      >
        <Boxes size={18} strokeWidth={1.9} />
      </button>

      <button
        type="button"
        aria-label="Add panel"
        aria-pressed={panel === "add"}
        className={cx(
          panelClass(panel === "add"),
          "mt-2",
          panel !== "add" && "bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800",
        )}
        onClick={() => onPanelToggle("add")}
      >
        <Plus size={20} strokeWidth={2} />
      </button>
    </nav>
  );
}
