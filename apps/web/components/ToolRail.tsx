// SPDX-License-Identifier: Apache-2.0
"use client";

import {
  Boxes,
  Hand,
  Layers3,
  MousePointer2,
} from "lucide-react";
import type { WorkspacePanel, WorkspaceTool } from "../lib/editor-workspace";
import { ToolButton } from "./editor-ui";

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
  return (
    <nav
      aria-label="Editor tools"
      className="z-40 flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-200 bg-white px-1.5 py-3"
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
        label="Structure panel"
        active={panel === "structure"}
        variant="panel"
        onClick={() => onPanelToggle("structure")}
      >
        <Layers3 size={18} strokeWidth={1.9} />
      </ToolButton>
      <ToolButton
        label="Resources panel"
        active={panel === "resources"}
        variant="panel"
        onClick={() => onPanelToggle("resources")}
      >
        <Boxes size={18} strokeWidth={1.9} />
      </ToolButton>

    </nav>
  );
}
