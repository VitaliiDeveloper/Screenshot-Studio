// SPDX-License-Identifier: Apache-2.0
import {
  rotatedElementBounds,
  findElementLocation,
  sameScreenGroup,
  type DesignLayout,
  type ElementBounds,
} from "@screenshot-studio/core/model";

/** Composite identity keeps duplicate element ids on different owner screens unambiguous. */
export interface SelectionRef {
  screenId: string;
  elementId: string;
}

export function selectionKey(selection: SelectionRef): string {
  return `${selection.screenId}\u0000${selection.elementId}`;
}

export function sameSelection(first: SelectionRef, second: SelectionRef): boolean {
  return first.screenId === second.screenId && first.elementId === second.elementId;
}

export function isSelected(selections: readonly SelectionRef[], candidate: SelectionRef): boolean {
  return selections.some((selection) => sameSelection(selection, candidate));
}

export function primarySelection(selections: readonly SelectionRef[]): SelectionRef | null {
  return selections.at(-1) ?? null;
}

export function toggleSelection(
  selections: readonly SelectionRef[],
  candidate: SelectionRef,
): SelectionRef[] {
  return isSelected(selections, candidate)
    ? selections.filter((selection) => !sameSelection(selection, candidate))
    : [...selections, candidate];
}

export function reconcileSelection(
  layout: DesignLayout,
  activeScreenId: string | null,
  selections: readonly SelectionRef[],
): SelectionRef[] {
  const active = layout.screens.find((screen) => screen.id === activeScreenId);
  if (!active) return [];
  const allowedScreenIds = new Set(
    layout.mode === "connected"
      ? layout.screens.filter((screen) => sameScreenGroup(screen, active)).map((screen) => screen.id)
      : [active.id],
  );
  const seen = new Set<string>();
  return selections.filter((selection) => {
    const key = selectionKey(selection);
    if (seen.has(key) || !allowedScreenIds.has(selection.screenId)) return false;
    const owner = layout.screens.find((screen) => screen.id === selection.screenId);
    const exists = owner ? findElementLocation(owner, selection.elementId) !== null : false;
    if (exists) seen.add(key);
    return exists;
  });
}

export function selectionBounds(
  layout: DesignLayout,
  activeScreenId: string,
  selections: readonly SelectionRef[],
): ElementBounds | null {
  return unionBounds(selectedStageBounds(layout, activeScreenId, selections).map((item) => item.bounds));
}

export type ArrangeAction =
  | "left" | "center" | "right"
  | "top" | "middle" | "bottom"
  | "distribute-horizontal" | "distribute-vertical";

/**
 * Per-selection translation that aligns or evenly spaces rotation-aware bounds inside
 * `selectionBounds`. Distribution keeps the outermost layers fixed and needs three or more layers.
 */
export function arrangeSelectionDeltas(
  layout: DesignLayout,
  activeScreenId: string,
  selections: readonly SelectionRef[],
  action: ArrangeAction,
): Map<string, { x: number; y: number }> {
  const items = selectedStageBounds(layout, activeScreenId, selections);
  const union = unionBounds(items.map((item) => item.bounds));
  const deltas = new Map<string, { x: number; y: number }>();
  if (!union || items.length < 2) return deltas;
  if (action === "distribute-horizontal" || action === "distribute-vertical") {
    if (items.length < 3) return deltas;
    const [min, max] = action === "distribute-horizontal" ? ["minX", "maxX"] as const : ["minY", "maxY"] as const;
    const sorted = [...items].sort((first, second) => first.bounds[min] - second.bounds[min]);
    const occupied = sorted.reduce((sum, { bounds }) => sum + bounds[max] - bounds[min], 0);
    const gap = (union[max] - union[min] - occupied) / (sorted.length - 1);
    let cursor = union[min];
    for (const { selection, bounds } of sorted) {
      const shift = cursor - bounds[min];
      deltas.set(selectionKey(selection), action === "distribute-horizontal" ? { x: shift, y: 0 } : { x: 0, y: shift });
      cursor += bounds[max] - bounds[min] + gap;
    }
    return deltas;
  }
  for (const { selection, bounds } of items) {
    const x = action === "left" ? union.minX - bounds.minX
      : action === "right" ? union.maxX - bounds.maxX
      : action === "center" ? (union.minX + union.maxX - bounds.minX - bounds.maxX) / 2
      : 0;
    const y = action === "top" ? union.minY - bounds.minY
      : action === "bottom" ? union.maxY - bounds.maxY
      : action === "middle" ? (union.minY + union.maxY - bounds.minY - bounds.maxY) / 2
      : 0;
    deltas.set(selectionKey(selection), { x, y });
  }
  return deltas;
}

function unionBounds(bounds: readonly ElementBounds[]): ElementBounds | null {
  if (bounds.length === 0) return null;
  return {
    minX: Math.min(...bounds.map((bound) => bound.minX)),
    minY: Math.min(...bounds.map((bound) => bound.minY)),
    maxX: Math.max(...bounds.map((bound) => bound.maxX)),
    maxY: Math.max(...bounds.map((bound) => bound.maxY)),
  };
}

/** Top-level selected elements with rotation-aware bounds in connected stage coordinates. */
function selectedStageBounds(
  layout: DesignLayout,
  activeScreenId: string,
  selections: readonly SelectionRef[],
): { selection: SelectionRef; bounds: ElementBounds }[] {
  const active = layout.screens.find((screen) => screen.id === activeScreenId);
  let x = 0;
  const connectedOrigins = active
    ? layout.screens.filter((screen) => sameScreenGroup(screen, active)).map((screen) => {
        const entry = [screen.id, x] as const;
        x += screen.artboard.width;
        return entry;
      })
    : [];
  const origins = new Map(layout.mode === "connected"
    ? connectedOrigins
    : [[activeScreenId, 0] as const]);
  const items: { selection: SelectionRef; bounds: ElementBounds }[] = [];
  for (const selection of selections) {
    const origin = origins.get(selection.screenId);
    if (origin === undefined) continue;
    const owner = layout.screens.find((screen) => screen.id === selection.screenId);
    const location = owner ? findElementLocation(owner, selection.elementId) : null;
    if (!location || location.parent) continue;
    const element = location.element;
    const local = rotatedElementBounds(element);
    items.push({
      selection,
      bounds: {
        minX: local.minX + origin,
        minY: local.minY,
        maxX: local.maxX + origin,
        maxY: local.maxY,
      },
    });
  }
  return items;
}

export function boundsIntersect(first: ElementBounds, second: ElementBounds): boolean {
  return first.minX <= second.maxX
    && first.maxX >= second.minX
    && first.minY <= second.maxY
    && first.maxY >= second.minY;
}
