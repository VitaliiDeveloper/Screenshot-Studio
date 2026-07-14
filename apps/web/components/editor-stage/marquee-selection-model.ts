// SPDX-License-Identifier: Apache-2.0
import type Konva from "konva";
import { rotatedElementBounds } from "@screenshot-studio/core/model";
import { boundsIntersect, toggleSelection, type SelectionRef } from "../../lib/editor-selection.js";
import type { StageProjection } from "./stage-model.js";

export interface ClientPoint {
  x: number;
  y: number;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const MARQUEE_DRAG_THRESHOLD_PX = 3;

export function stagePointerPosition(stage: Konva.Stage): ClientPoint | null {
  const point = stage.getPointerPosition();
  const zoom = stage.scaleX();
  return point ? { x: point.x / zoom, y: point.y / zoom } : null;
}

export function marqueeBounds(start: ClientPoint, current: ClientPoint): Rect {
  return {
    minX: Math.min(start.x, current.x),
    minY: Math.min(start.y, current.y),
    maxX: Math.max(start.x, current.x),
    maxY: Math.max(start.y, current.y),
  };
}

export function marqueeHasMoved(start: ClientPoint, current: ClientPoint, zoom: number): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= MARQUEE_DRAG_THRESHOLD_PX / zoom;
}

export interface ResolveMarqueeSelectionInput {
  bounds: Rect;
  projections: readonly StageProjection[];
  baseX: number;
  initial: readonly SelectionRef[];
  toggle: boolean;
}

export function resolveMarqueeSelection({
  bounds,
  projections,
  baseX,
  initial,
  toggle,
}: ResolveMarqueeSelectionInput): SelectionRef[] {
  const hits: SelectionRef[] = [];
  for (const projection of projections) {
    for (const element of projection.screen.elements) {
      if (!element.visible) continue;
      const local = rotatedElementBounds(element);
      const projected = {
        minX: local.minX + projection.x + baseX,
        minY: local.minY + projection.y,
        maxX: local.maxX + projection.x + baseX,
        maxY: local.maxY + projection.y,
      };
      if (boundsIntersect(bounds, projected)) {
        hits.push({ screenId: projection.screen.id, elementId: element.id });
      }
    }
  }
  return toggle
    ? hits.reduce((items, hit) => toggleSelection(items, hit), [...initial])
    : hits;
}
