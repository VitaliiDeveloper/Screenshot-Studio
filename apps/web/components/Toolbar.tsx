"use client";

import { useState } from "react";
import { useStore } from "zustand";
import type { Element } from "@screenshot-studio/core/model";
import { createTextElement, createShapeElement } from "@screenshot-studio/core/model";
import { editorStore } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { ExportDialog } from "./ExportDialog";
import { FontManagerDialog } from "./FontManagerDialog";

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
  const defaultFont = useStore(editorStore, (state) => state.project?.fonts[0]);

  const insertText = () => {
    if (!defaultFont) {
      setFontsOpen(true);
      return;
    }
    insert(createTextElement({ font: defaultFont }));
  };

  const btn = "rounded border border-neutral-300 bg-white px-2 py-1 text-xs hover:bg-neutral-100";

  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 bg-white px-3 py-2">
      <button className={btn} onClick={insertText} title={defaultFont ? undefined : "Register a font before adding text"}>+ Text</button>
      <button className={btn} onClick={() => insert(createShapeElement())}>+ Shape</button>
      <button className={btn} onClick={() => setFontsOpen(true)}>Fonts</button>
      <button className={btn} onClick={() => setExportOpen(true)}>Export</button>
      <FontManagerDialog open={fontsOpen} onClose={() => setFontsOpen(false)} />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <div className="ml-auto flex items-center gap-1">
        <button className={btn} aria-label="Zoom out" onClick={onZoomOut}>−</button>
        <span className="w-12 text-center text-xs tabular-nums text-neutral-500">{Math.round(zoom * 100)}%</span>
        <button className={btn} aria-label="Zoom in" onClick={onZoomIn}>+</button>
        <button className={btn} onClick={onZoomReset}>Reset</button>
      </div>
    </div>
  );
}
