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

/**
 * The screens an edit on `source` writes to, in layout order and always in `source`'s locale.
 * shortcut: destinations keep no persisted slot link, so their slots match by primary-screen
 * position (a new destination is an ordered copy of the source's screens); diverged orders need a
 * persisted link, which is a schema change.
 */
export function applyScopeScreens(layout: DesignLayout, source: Screen, scope: ApplyScope): Screen[] {
  if (scope === "screen") return [source];
  const root = source.variantOf
    ? layout.screens.find((screen) => screen.id === source.variantOf)
    : isPrimaryScreen(source) ? source : undefined;
  if (scope === "family" || !root) return slotScreens(layout, source);

  const rootsByFamily = new Map<string, Screen[]>();
  for (const screen of layout.screens) {
    if (!isPrimaryScreen(screen) || screen.locale !== source.locale) continue;
    rootsByFamily.set(familyKey(screen), [...(rootsByFamily.get(familyKey(screen)) ?? []), screen]);
  }
  const position = rootsByFamily.get(familyKey(root))!.indexOf(root);
  const ids = new Set([...rootsByFamily.values()].flatMap((roots) =>
    roots[position] ? slotScreens(layout, roots[position]).map((screen) => screen.id) : []
  ));
  return layout.screens.filter((screen) => ids.has(screen.id));
}

/**
 * One layer edit, resolved per screen in scope. The edited layer takes the patch as given; its
 * counterpart on another size takes the patched fields of the edited layer fitted into that
 * artboard, the same fit sizes are created with, so pixel metrics scale and the rest is copied.
 * Unmatched, locked, and other-type counterparts are skipped, as is a size the fit cannot take.
 */
export function scopedElementPatches(
  layout: DesignLayout,
  sourceScreenId: string,
  elementId: string,
  request: ElementPatchRequest,
  scope: ApplyScope,
): ScopedElementPatch[] {
  const self = [{ screenId: sourceScreenId, elementId, patch: request.patch }];
  const source = layout.screens.find((screen) => screen.id === sourceScreenId);
  const location = source ? findElementLocation(source, elementId) : null;
  if (scope === "screen" || !source || !location) return self;

  const edited = structuredClone(location.parent ?? location.element);
  const editedLeaf = (top: Element) => location.parent && top.type === "group"
    ? top.children.find((child) => child.id === elementId)!
    : top;
  if (!applyMatchingElementPatch(editedLeaf(edited), request)) return [];

  const writes: ScopedElementPatch[] = [];
  for (const screen of applyScopeScreens(layout, source, scope)) {
    if (screen.id === source.id) {
      writes.push(...self);
      continue;
    }
    const counterpart = slotCounterpart(source, elementId, screen);
    const counterpartParent = counterpart ? findElementLocation(screen, counterpart.id)?.parent : null;
    if (!counterpart || counterpart.type !== request.type || counterpart.locked || counterpartParent?.locked) {
      continue;
    }
    let fitted: Record<string, unknown>;
    try {
      fitted = editedLeaf(fitElementsToArtboard([edited], source.artboard, screen.artboard)[0]!);
    } catch {
      continue; // Scaling up pushed a bounded metric (shadow blur, stroke width) past its maximum.
    }
    const patch = Object.fromEntries(Object.entries(request.patch).map(([key, value]) => [
      key,
      value === null ? null : fitted[key],
    ])) as ElementPatch;
    writes.push({ screenId: screen.id, elementId: counterpart.id, patch });
  }
  return writes;
}
