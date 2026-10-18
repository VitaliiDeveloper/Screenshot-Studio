// SPDX-License-Identifier: Apache-2.0
"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import { editorUi } from "@web/components/editor-ui";

/** Zoom out / reset / in and Fit, centred in the area between the side panels. */
export function CanvasZoomControls({
  zoom,
  leftInset,
  rightInset,
  onZoom,
  onFit,
}: {
  zoom: number;
  leftInset: number;
  rightInset: number;
  onZoom: (zoom: number) => void;
  onFit: () => void;
}) {
  return (
    <div
      className="absolute bottom-4 z-20 flex -translate-x-1/2 items-center rounded-xl border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10"
      style={{ left: `calc(50% + ${(leftInset - rightInset) / 2}px)` }}
      aria-label="Zoom controls"
    >
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
