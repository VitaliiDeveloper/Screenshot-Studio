// SPDX-License-Identifier: Apache-2.0
"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import { editorUi } from "@web/components/editor-ui";

export function CanvasZoomControls({
  zoom,
  onZoom,
  onFit,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
  onFit: () => void;
}) {
  return (
    <div role="group" className="flex items-center" aria-label="Zoom controls">
      <button type="button" className={editorUi.iconButton} aria-label="Zoom out" onClick={() => onZoom(zoom - 0.1)}>
        <Minus size={15} strokeWidth={2} />
      </button>
      <button type="button" className="h-8 w-14 rounded-lg text-center text-xs font-semibold tabular-nums text-slate-700 hover:bg-slate-50" onClick={() => onZoom(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className={editorUi.iconButton} aria-label="Zoom in" onClick={() => onZoom(zoom + 0.1)}>
        <Plus size={15} strokeWidth={2} />
      </button>
      <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
      <button type="button" className={editorUi.buttonGhost} onClick={onFit}>
        <Maximize2 size={14} strokeWidth={1.9} /> Fit
      </button>
    </div>
  );
}
