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
  const bounds: ElementBounds[] = [];
  for (const selection of selections) {
    const origin = origins.get(selection.screenId);
    if (origin === undefined) continue;
    const owner = layout.screens.find((screen) => screen.id === selection.screenId);
    const location = owner ? findElementLocation(owner, selection.elementId) : null;
    if (!location || location.parent) continue;
    const element = location.element;
    const local = rotatedElementBounds(element);
    bounds.push({
      minX: local.minX + origin,
      minY: local.minY,
      maxX: local.maxX + origin,
      maxY: local.maxY,
    });
  }
  if (bounds.length === 0) return null;
  return {
    minX: Math.min(...bounds.map((bound) => bound.minX)),
    minY: Math.min(...bounds.map((bound) => bound.minY)),
    maxX: Math.max(...bounds.map((bound) => bound.maxX)),
    maxY: Math.max(...bounds.map((bound) => bound.maxY)),
  };
}

export function boundsIntersect(first: ElementBounds, second: ElementBounds): boolean {
  return first.minX <= second.maxX
    && first.maxX >= second.minX
    && first.minY <= second.maxY
    && first.maxY >= second.minY;
}
