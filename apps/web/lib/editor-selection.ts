// SPDX-License-Identifier: Apache-2.0
import {
  projectScreenGroup,
  rotatedElementBounds,
  type ElementBounds,
  type Project,
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
  project: Project,
  activeScreenId: string | null,
  selections: readonly SelectionRef[],
): SelectionRef[] {
  const active = project.screens.find((screen) => screen.id === activeScreenId);
  if (!active) return [];
  const allowedScreenIds = new Set(
    project.mode === "connected"
      ? projectScreenGroup(project, active.id).map((entry) => entry.screen.id)
      : [active.id],
  );
  const seen = new Set<string>();
  return selections.filter((selection) => {
    const key = selectionKey(selection);
    if (seen.has(key) || !allowedScreenIds.has(selection.screenId)) return false;
    const owner = project.screens.find((screen) => screen.id === selection.screenId);
    const exists = owner?.elements.some((element) => element.id === selection.elementId) ?? false;
    if (exists) seen.add(key);
    return exists;
  });
}

export function selectionBounds(
  project: Project,
  activeScreenId: string,
  selections: readonly SelectionRef[],
): ElementBounds | null {
  const origins = new Map(
    project.mode === "connected"
      ? projectScreenGroup(project, activeScreenId).map((entry) => [entry.screen.id, entry.x] as const)
      : [[activeScreenId, 0] as const],
  );
  const bounds: ElementBounds[] = [];
  for (const selection of selections) {
    const origin = origins.get(selection.screenId);
    if (origin === undefined) continue;
    const owner = project.screens.find((screen) => screen.id === selection.screenId);
    const element = owner?.elements.find((candidate) => candidate.id === selection.elementId);
    if (!element) continue;
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
