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
import type { ResourceDialog, WorkspacePanel, WorkspaceTool } from "@web/lib/editor/editor-workspace";
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
      className="z-40 flex h-full w-15 shrink-0 flex-col items-center gap-0.5 border-r border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] py-2"
    >
      <ToolButton label="Select tool" caption="Select" active={tool === "select"} onClick={() => onToolChange("select")}>
        <MousePointer2 size={16} strokeWidth={1.9} />
      </ToolButton>
      <ToolButton label="Hand tool" caption="Hand" active={tool === "hand"} onClick={() => onToolChange("hand")}>
        <Hand size={16} strokeWidth={1.9} />
      </ToolButton>

      <span className="my-1.5 h-px w-7 bg-[var(--editor-color-border)]" aria-hidden="true" />

      <ToolButton
        label="Layers panel"
        caption="Layers"
        active={panel === "structure"}
        onClick={() => onPanelToggle("structure")}
      >
        <Layers3 size={16} strokeWidth={1.9} />
      </ToolButton>
      <ToolButton label="Screen templates" caption="Templates" aria-haspopup="dialog" onClick={() => onOpenDialog("templates")}>
        <LayoutTemplate size={16} strokeWidth={1.9} />
      </ToolButton>
      {/* The caption must stay inside the accessible name (WCAG 2.5.3), so it is "Packs", not "Themes". */}
      <ToolButton label="Design packs" caption="Packs" aria-haspopup="dialog" onClick={() => onOpenDialog("themes")}>
        <Palette size={16} strokeWidth={1.9} />
      </ToolButton>
      <ToolButton label="Fonts" caption="Fonts" aria-haspopup="dialog" onClick={() => onOpenDialog("fonts")}>
        <Type size={16} strokeWidth={1.9} />
      </ToolButton>
      <ToolButton label="Locales" caption="Locales" aria-haspopup="dialog" onClick={onOpenLocales}>
        <Languages size={16} strokeWidth={1.9} />
      </ToolButton>

      <ToolButton
        label="Projects"
        caption="Projects"
        disabled={projectsBusy}
        onClick={onOpenProjects}
        className="mt-auto disabled:cursor-wait disabled:opacity-60"
      >
        {projectsBusy
          ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          : <House aria-hidden="true" size={16} strokeWidth={1.9} />}
      </ToolButton>
    </nav>
  );
}
