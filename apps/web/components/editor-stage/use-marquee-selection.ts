// SPDX-License-Identifier: Apache-2.0
"use client";

import { useRef, useState } from "react";
import type Konva from "konva";
import type { SelectionRef } from "../../lib/editor-selection.js";
import type { StageProjection } from "./stage-model.js";
import {
  marqueeBounds,
  marqueeHasMoved,
  resolveMarqueeSelection,
  stagePointerPosition,
  type ClientPoint,
} from "./marquee-selection-model.js";

export interface MarqueeState {
  start: ClientPoint;
  current: ClientPoint;
  initial: SelectionRef[];
  toggle: boolean;
}

export interface MarqueeSelectionInput {
  canEdit: boolean;
  zoom: number;
  projections: readonly StageProjection[];
  baseX: number;
  selectedItems: readonly SelectionRef[];
  setSelection: (items: SelectionRef[]) => void;
}

function selectionModifier(event: Konva.KonvaEventObject<Event>): boolean {
  const native = event.evt as MouseEvent;
  return native.shiftKey || native.metaKey || native.ctrlKey;
}

export function useMarqueeSelection({
  canEdit,
  zoom,
  projections,
  baseX,
  selectedItems,
  setSelection,
}: MarqueeSelectionInput) {
  const movedRef = useRef(false);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);

  const hasMoved = (value: MarqueeState) => marqueeHasMoved(value.start, value.current, zoom);

  const onMouseDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (!canEdit) return;
    const stage = event.target.getStage();
    const blank = event.target === stage || event.target.name() === "artboard-background";
    if (!stage || !blank) return;
    const point = stagePointerPosition(stage);
    if (!point) return;
    movedRef.current = false;
    setMarquee({
      start: point,
      current: point,
      initial: [...selectedItems],
      toggle: selectionModifier(event),
    });
  };

  const onMouseMove = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (!marquee) return;
    const stage = event.target.getStage();
    if (!stage) return;
    const point = stagePointerPosition(stage);
    if (!point) return;
    if (marqueeHasMoved(marquee.start, point, zoom)) movedRef.current = true;
    setMarquee({ ...marquee, current: point });
  };

  const onMouseUp = () => {
    if (!marquee) return;
    if (movedRef.current) {
      setSelection(resolveMarqueeSelection({
        bounds: marqueeBounds(marquee.start, marquee.current),
        projections,
        baseX,
        initial: marquee.initial,
        toggle: marquee.toggle,
      }));
    }
    setMarquee(null);
    window.setTimeout(() => { movedRef.current = false; }, 0);
  };

  return {
    marquee,
    movedRef,
    selectionModifier,
    hasMoved,
    bounds: marquee ? marqueeBounds(marquee.start, marquee.current) : null,
    onMouseDown,
    onMouseMove,
    onMouseUp,
  };
}
