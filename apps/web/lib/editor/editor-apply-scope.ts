// SPDX-License-Identifier: Apache-2.0
import {
  findElementLocation,
  fitElementsToArtboard,
  isPrimaryScreen,
  slotCounterpart,
  slotScreens,
  type DesignLayout,
  type Element,
  type Screen,
} from "@screenshot-studio/core/model";
import {
  applyMatchingElementPatch,
  type ElementPatch,
  type ElementPatchRequest,
} from "./editor-element-patch.js";

/**
 * Which exact-size screens one edit writes to (Apply to): this screen, every size of its slot in
 * this destination, or that slot in every destination. Editor UI state only; never persisted.
 */
export type ApplyScope = "screen" | "family" | "destinations";

export interface ScopedElementPatch {
  screenId: string;
  elementId: string;
  patch: ElementPatch;
}

function familyKey(screen: Screen): string {
  return `${screen.platform}/${screen.device}`;
}

/** The screens a scope reaches, plus the destinations it leaves out because their slot is unclear. */
export interface ApplyScopeScreens {
  screens: Screen[];
  skippedDestinations: number;
}

/** The layer writes of one scoped edit, plus the other in-scope sizes it leaves untouched. */
export interface ScopedElementPatches {
  writes: ScopedElementPatch[];
  skippedSizes: number;
}

/**
 * The screens an edit on `source` writes to, in layout order and always in `source`'s locale.
 * shortcut: destinations keep no persisted slot link, so a destination pairs with the primary
 * screen at the same position only while that screen keeps the source slot's name (a new
 * destination is an ordered, same-named copy); any other destination is skipped and counted.
 * Pairing diverged orders needs a persisted slot link, which is a schema change.
 */
export function applyScopeScreens(layout: DesignLayout, source: Screen, scope: ApplyScope): ApplyScopeScreens {
  if (scope === "screen") return { screens: [source], skippedDestinations: 0 };
  const root = source.variantOf
    ? layout.screens.find((screen) => screen.id === source.variantOf)
    : isPrimaryScreen(source) ? source : undefined;
  if (scope === "family" || !root) return { screens: slotScreens(layout, source), skippedDestinations: 0 };

  const rootsByFamily = new Map<string, Screen[]>();
  for (const screen of layout.screens) {
    if (!isPrimaryScreen(screen) || screen.locale !== source.locale) continue;
    rootsByFamily.set(familyKey(screen), [...(rootsByFamily.get(familyKey(screen)) ?? []), screen]);
  }
  const position = rootsByFamily.get(familyKey(root))!.indexOf(root);
  const peers = [...rootsByFamily.values()].map((roots) => roots[position]);
  const paired = peers.filter((peer) => peer?.name === root.name);
  const ids = new Set(paired.flatMap((peer) => slotScreens(layout, peer!).map((screen) => screen.id)));
  return {
    screens: layout.screens.filter((screen) => ids.has(screen.id)),
    skippedDestinations: peers.length - paired.length,
  };
}

// Core throws plain Errors when a scaled value leaves its range (a bounded metric or the strict
// schema); both messages start with this prefix. Anything else is a bug and must surface.
function isScaleRangeError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Cannot scale ");
}

/**
 * One layer edit, resolved per screen in scope. The edited layer takes the patch as given; its
 * counterpart on another size takes the patched fields of the edited layer fitted into that
 * artboard, the same fit sizes are created with, so pixel metrics scale and the rest is copied.
 * Each patched field replaces the counterpart's value; it is never a delta.
 * Unmatched, locked, and other-type counterparts are skipped and counted, as is a size the fit
 * cannot take. An empty patch reports which sizes an edit of this layer would reach.
 */
export function scopedElementPatches(
  layout: DesignLayout,
  sourceScreenId: string,
  elementId: string,
  request: ElementPatchRequest,
  scope: ApplyScope,
): ScopedElementPatches {
  const self = { writes: [{ screenId: sourceScreenId, elementId, patch: request.patch }], skippedSizes: 0 };
  const source = layout.screens.find((screen) => screen.id === sourceScreenId);
  const location = source ? findElementLocation(source, elementId) : null;
  if (scope === "screen" || !source || !location) return self;

  const edited = structuredClone(location.parent ?? location.element);
  const editedLeaf = (top: Element) => location.parent && top.type === "group"
    ? top.children.find((child) => child.id === elementId)!
    : top;
  if (!applyMatchingElementPatch(editedLeaf(edited), request)) return { writes: [], skippedSizes: 0 };

  const writes: ScopedElementPatch[] = [];
  let skippedSizes = 0;
  for (const screen of applyScopeScreens(layout, source, scope).screens) {
    if (screen.id === source.id) {
      writes.push(...self.writes);
      continue;
    }
    const counterpart = slotCounterpart(source, elementId, screen);
    const counterpartParent = counterpart ? findElementLocation(screen, counterpart.id)?.parent : null;
    if (!counterpart || counterpart.type !== request.type || counterpart.locked || counterpartParent?.locked) {
      skippedSizes += 1;
      continue;
    }
    let fitted: Record<string, unknown>;
    try {
      fitted = editedLeaf(fitElementsToArtboard([edited], source.artboard, screen.artboard)[0]!);
    } catch (error) {
      if (!isScaleRangeError(error)) throw error;
      skippedSizes += 1;
      continue;
    }
    const patch = Object.fromEntries(Object.entries(request.patch).map(([key, value]) => [
      key,
      value === null ? null : fitted[key],
    ])) as ElementPatch;
    writes.push({ screenId: screen.id, elementId: counterpart.id, patch });
  }
  return { writes, skippedSizes };
}
