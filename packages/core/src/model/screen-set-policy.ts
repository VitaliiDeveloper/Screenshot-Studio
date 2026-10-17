// SPDX-License-Identifier: Apache-2.0
import type { DesignLayout, Element, Screen, ScreenSetMode } from "./schema.js";

export type OutputFamilyRef = Pick<Screen, "platform" | "device" | "locale">;

export function sameOutputFamily(screen: Screen, family: OutputFamilyRef): boolean {
  return screen.platform === family.platform
    && screen.device === family.device
    && screen.locale === family.locale;
}

/** Primary-size identity is defined by output identity, never by presentation or pairing state. */
export function isPrimaryScreen(screen: Pick<Screen, "storeTargetId">): boolean {
  return screen.storeTargetId === undefined;
}

/** Older v1 documents have no policy rows and intentionally remain independent. */
export function screenSetModeFor(
  layout: DesignLayout,
  family: OutputFamilyRef,
): ScreenSetMode {
  return layout.screenSetPolicies?.find((policy) =>
    policy.platform === family.platform
    && policy.device === family.device
    && policy.locale === family.locale
  )?.mode ?? "independent";
}

/**
 * Keep each exact target's persisted order aligned with the root/master order. Other output
 * families retain both their relative order and their positions in the project document.
 */
export function alignSynchronizedScreenSets(
  screens: readonly Screen[],
  family: OutputFamilyRef,
): Screen[] {
  const next = [...screens];
  const roots = next.filter((screen) =>
    sameOutputFamily(screen, family) && isPrimaryScreen(screen)
  );
  const rootPosition = new Map(roots.map((screen, index) => [screen.id, index]));
  const targetIds = Array.from(new Set(next
    .filter((screen) => sameOutputFamily(screen, family) && screen.storeTargetId !== undefined)
    .map((screen) => screen.storeTargetId!)));

  for (const targetId of targetIds) {
    const indices = next
      .map((screen, index) => (
        sameOutputFamily(screen, family) && screen.storeTargetId === targetId ? index : -1
      ))
      .filter((index) => index >= 0);
    const ordered = indices
      .map((index) => next[index]!)
      .sort((left, right) => (
        (rootPosition.get(left.variantOf!) ?? Number.MAX_SAFE_INTEGER)
        - (rootPosition.get(right.variantOf!) ?? Number.MAX_SAFE_INTEGER)
      ));
    indices.forEach((index, position) => { next[index] = ordered[position]!; });
  }

  return next;
}

/** Reorder one logical slot and mirror that order into every exact target in the family. */
export function reorderSynchronizedScreenSets(
  screens: readonly Screen[],
  family: OutputFamilyRef,
  fromRootId: string,
  toRootId: string,
): Screen[] {
  const next = [...screens];
  const indices = next
    .map((screen, index) => (
      sameOutputFamily(screen, family) && isPrimaryScreen(screen) ? index : -1
    ))
    .filter((index) => index >= 0);
  const roots = indices.map((index) => next[index]!);
  const from = roots.findIndex((screen) => screen.id === fromRootId);
  const to = roots.findIndex((screen) => screen.id === toRootId);
  if (from < 0 || to < 0 || from === to) return alignSynchronizedScreenSets(next, family);

  const [moved] = roots.splice(from, 1);
  roots.splice(to, 0, moved!);
  indices.forEach((index, position) => { next[index] = roots[position]!; });
  return alignSynchronizedScreenSets(next, family);
}

/**
 * The exact-size screens of one logical slot in layout order: the primary screen and its variants.
 * A standalone exact-size screen is a slot of its own.
 */
export function slotScreens(layout: DesignLayout, screen: Screen): Screen[] {
  const rootId = screen.variantOf ?? (isPrimaryScreen(screen) ? screen.id : undefined);
  if (!rootId) return [screen];
  return layout.screens.filter((candidate) => candidate.id === rootId || candidate.variantOf === rootId);
}

function layerStructure(elements: readonly Element[]): string {
  return JSON.stringify(elements.map((element) =>
    element.type === "group" ? element.children.map((child) => child.type) : element.type
  ));
}

/**
 * The same layer on another exact-size screen of its slot. Layers keep no link across sizes
 * (variants are fitted clones with fresh ids), so a counterpart exists only while both screens keep
 * the same layer structure, and it is the layer at the same position.
 * shortcut: one added or deleted layer on either size unmatches the whole screen; a persisted layer
 * link needs a schema change if users need matching across diverged sizes.
 */
export function slotCounterpart(source: Screen, elementId: string, target: Screen): Element | null {
  if (layerStructure(source.elements) !== layerStructure(target.elements)) return null;
  for (const [index, element] of source.elements.entries()) {
    if (element.id === elementId) return target.elements[index]!;
    if (element.type !== "group") continue;
    const childIndex = element.children.findIndex((child) => child.id === elementId);
    const group = target.elements[index]!;
    if (childIndex >= 0 && group.type === "group") return group.children[childIndex]!;
  }
  return null;
}
