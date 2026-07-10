import {
  rotatedElementBounds,
  type Element,
  type ElementBounds,
  type Screen,
} from "@screenshot-studio/core/model";

export const SNAP_THRESHOLD_PX = 6;

export interface SnapProjection {
  screen: Screen;
  x: number;
  y: number;
}

export interface SnapGuide {
  axis: "x" | "y";
  position: number;
  targetKind: "element" | "artboard" | "group";
  targetId: string;
}

export interface SnapDragResult {
  position: { x: number; y: number };
  guides: SnapGuide[];
}

interface AxisTarget {
  value: number;
  kind: SnapGuide["targetKind"];
  id: string;
  priority: number;
  order: number;
}

interface AxisMatch extends AxisTarget {
  delta: number;
  distance: number;
  movingAnchorOrder: number;
}

function translateBounds(bounds: ElementBounds, x: number, y: number): ElementBounds {
  return {
    minX: bounds.minX + x,
    minY: bounds.minY + y,
    maxX: bounds.maxX + x,
    maxY: bounds.maxY + y,
  };
}

function axisAnchors(min: number, max: number): number[] {
  return [min, (min + max) / 2, max];
}

function appendBoundsTargets(
  xTargets: AxisTarget[],
  yTargets: AxisTarget[],
  bounds: ElementBounds,
  kind: SnapGuide["targetKind"],
  id: string,
  priority: number,
  order: number,
): void {
  axisAnchors(bounds.minX, bounds.maxX).forEach((value, anchorOrder) => {
    xTargets.push({ value, kind, id, priority, order: order * 3 + anchorOrder });
  });
  axisAnchors(bounds.minY, bounds.maxY).forEach((value, anchorOrder) => {
    yTargets.push({ value, kind, id, priority, order: order * 3 + anchorOrder });
  });
}

function isBetterMatch(candidate: AxisMatch, current: AxisMatch | null): boolean {
  if (!current) return true;
  if (candidate.distance !== current.distance) return candidate.distance < current.distance;
  if (candidate.priority !== current.priority) return candidate.priority < current.priority;
  if (candidate.order !== current.order) return candidate.order < current.order;
  return candidate.movingAnchorOrder < current.movingAnchorOrder;
}

function bestAxisMatch(
  movingAnchors: readonly number[],
  targets: readonly AxisTarget[],
  threshold: number,
): AxisMatch | null {
  let best: AxisMatch | null = null;
  for (let movingAnchorOrder = 0; movingAnchorOrder < movingAnchors.length; movingAnchorOrder += 1) {
    const moving = movingAnchors[movingAnchorOrder]!;
    for (const target of targets) {
      const delta = target.value - moving;
      const distance = Math.abs(delta);
      if (distance > threshold) continue;
      const candidate = { ...target, delta, distance, movingAnchorOrder };
      if (isBetterMatch(candidate, best)) best = candidate;
    }
  }
  return best;
}

/**
 * Snap one dragged element in the active stage coordinate space. Persisted coordinates remain
 * owner-local; projections and guides are transient editor inputs/outputs only.
 */
export function snapElementDrag({
  element,
  ownerScreenId,
  position,
  projections,
  stage,
  zoom,
}: {
  element: Element;
  ownerScreenId: string;
  position: { x: number; y: number };
  projections: readonly SnapProjection[];
  stage: { width: number; height: number };
  zoom: number;
}): SnapDragResult {
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("Snap zoom must be positive");
  const owner = projections.find((projection) => projection.screen.id === ownerScreenId);
  if (!owner) throw new Error(`Snap owner screen "${ownerScreenId}" is outside the active stage`);

  const xTargets: AxisTarget[] = [];
  const yTargets: AxisTarget[] = [];
  let order = 0;
  appendBoundsTargets(
    xTargets,
    yTargets,
    { minX: 0, minY: 0, maxX: stage.width, maxY: stage.height },
    "group",
    "active-group",
    2,
    order++,
  );

  for (const projection of projections) {
    appendBoundsTargets(
      xTargets,
      yTargets,
      {
        minX: projection.x,
        minY: projection.y,
        maxX: projection.x + projection.screen.artboard.width,
        maxY: projection.y + projection.screen.artboard.height,
      },
      "artboard",
      projection.screen.id,
      1,
      order++,
    );
  }

  for (const projection of projections) {
    for (const target of projection.screen.elements) {
      if (
        !target.visible
        || target.opacity === 0
        || (projection.screen.id === ownerScreenId && target.id === element.id)
      ) continue;
      appendBoundsTargets(
        xTargets,
        yTargets,
        translateBounds(rotatedElementBounds(target), projection.x, projection.y),
        "element",
        `${projection.screen.id}:${target.id}`,
        0,
        order++,
      );
    }
  }

  const moving = translateBounds(
    rotatedElementBounds({ ...element, x: position.x, y: position.y }),
    owner.x,
    owner.y,
  );
  const threshold = SNAP_THRESHOLD_PX / zoom;
  const xMatch = bestAxisMatch(axisAnchors(moving.minX, moving.maxX), xTargets, threshold);
  const yMatch = bestAxisMatch(axisAnchors(moving.minY, moving.maxY), yTargets, threshold);
  const guides: SnapGuide[] = [];
  if (xMatch) {
    guides.push({
      axis: "x",
      position: xMatch.value,
      targetKind: xMatch.kind,
      targetId: xMatch.id,
    });
  }
  if (yMatch) {
    guides.push({
      axis: "y",
      position: yMatch.value,
      targetKind: yMatch.kind,
      targetId: yMatch.id,
    });
  }
  return {
    position: {
      x: position.x + (xMatch?.delta ?? 0),
      y: position.y + (yMatch?.delta ?? 0),
    },
    guides,
  };
}
