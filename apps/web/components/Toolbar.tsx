"use client";

import { useState } from "react";
import { useStore } from "zustand";
import {
  Download,
  Frame,
  LayoutTemplate,
  Palette,
  RotateCcw,
  Shapes,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Element } from "@screenshot-studio/core/model";
import { createTextElement, createShapeElement } from "@screenshot-studio/core/model";
import { editorStore } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { ExportDialog } from "./ExportDialog";
import { FontManagerDialog } from "./FontManagerDialog";
import { ThemeManagerDialog } from "./ThemeManagerDialog";
import { TemplateLibraryDialog } from "./TemplateLibraryDialog";
import { editorUi } from "./editor-ui";

/**
 * Editor toolbar: insert-on-click element tools (text + shape only — asset-bearing types are
 * inspector-edited, spec scope) plus zoom controls. Insert is a discrete action, so it persists
 * immediately (unlike the debounced inspector inputs).
 */
export function Toolbar({
  zoom, onZoomIn, onZoomOut, onZoomReset,
}: { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onZoomReset: () => void }) {
  const insert = (element: Element) => {
    mutateAndSave(() => editorStore.getState().addElement(element));
  };

  const [exportOpen, setExportOpen] = useState(false);
  const [fontsOpen, setFontsOpen] = useState(false);
  const [themesOpen, setThemesOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const defaultFont = useStore(editorStore, (state) => state.project?.fonts[0]);

  const insertText = () => {
    if (!defaultFont) {
      setFontsOpen(true);
      return;
    }
    insert(createTextElement({ font: defaultFont }));
  };

  return (
    <div className="flex min-h-14 items-center gap-2 border-b border-slate-200 bg-white px-4 shadow-[0_1px_0_rgba(15,23,42,0.02)]">
      <div className="flex items-center gap-1.5" aria-label="Insert elements">
        <button aria-label="+ Text" className={editorUi.buttonSecondary} onClick={insertText} title={defaultFont ? undefined : "Register a font before adding text"}>
          <Type size={14} strokeWidth={1.9} /> Text
        </button>
        <button aria-label="+ Shape" className={editorUi.buttonSecondary} onClick={() => insert(createShapeElement())}>
          <Shapes size={14} strokeWidth={1.9} /> Shape
        </button>
      </div>
      <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
      <div className="flex items-center gap-1" aria-label="Project resources">
        <button className={editorUi.buttonGhost} onClick={() => setFontsOpen(true)}>
          <Frame size={14} strokeWidth={1.9} /> Fonts
        </button>
        <button className={editorUi.buttonGhost} onClick={() => setThemesOpen(true)}>
          <Palette size={14} strokeWidth={1.9} /> Themes
        </button>
        <button className={editorUi.buttonGhost} onClick={() => setTemplatesOpen(true)}>
          <LayoutTemplate size={14} strokeWidth={1.9} /> Templates
        </button>
      </div>
      <button className={`${editorUi.buttonPrimary} ml-1`} onClick={() => setExportOpen(true)}>
        <Download size={14} strokeWidth={2} /> Export
      </button>
      <FontManagerDialog open={fontsOpen} onClose={() => setFontsOpen(false)} />
      {themesOpen ? <ThemeManagerDialog onClose={() => setThemesOpen(false)} /> : null}
      {templatesOpen ? <TemplateLibraryDialog onClose={() => setTemplatesOpen(false)} /> : null}
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <div className="ml-auto flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button className={editorUi.iconButton} aria-label="Zoom out" onClick={onZoomOut}>
          <ZoomOut size={14} strokeWidth={1.9} />
        </button>
        <span className="w-12 text-center text-xs font-medium tabular-nums text-slate-600">{Math.round(zoom * 100)}%</span>
        <button className={editorUi.iconButton} aria-label="Zoom in" onClick={onZoomIn}>
          <ZoomIn size={14} strokeWidth={1.9} />
        </button>
        <button className={editorUi.buttonGhost} onClick={onZoomReset}>
          <RotateCcw size={13} strokeWidth={1.9} /> Reset
        </button>
      </div>
    </div>
  );
}
