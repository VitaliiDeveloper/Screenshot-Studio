// SPDX-License-Identifier: Apache-2.0
import type { Screen } from "@screenshot-studio/core/model";
import {
  elementLabel,
  elementTextDescription,
  elementTypeLabel,
  screenTreeSummary,
} from "@web/lib/panel-helpers";

export const MAX_SEARCH_RESULTS = 50;

export interface SearchResult {
  /** A screen result has no `elementId`. */
  screenId: string;
  elementId?: string;
  label: string;
  /** Second line: a screen's layer count, or a layer's type and screen. */
  detail: string;
}

/**
 * The screens and top-level layers the Layers panel lists, in its order (each screen, then its
 * layers front-most first), narrowed to those whose name, text, or type contains the query.
 */
export function findScreensAndLayers(screens: readonly Screen[], query: string): SearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = (...fields: Array<string | null>) =>
    !needle || fields.some((field) => field?.toLocaleLowerCase().includes(needle));
  const results: SearchResult[] = [];
  for (const screen of screens) {
    if (matches(screen.name)) {
      results.push({
        screenId: screen.id,
        label: screen.name,
        detail: screenTreeSummary(screen.elements.length, 0),
      });
    }
    for (const element of [...screen.elements].reverse()) {
      const label = elementLabel(element);
      const type = elementTypeLabel(element.type);
      if (matches(label, elementTextDescription(element), type)) {
        results.push({
          screenId: screen.id,
          elementId: element.id,
          label,
          detail: `${type} · ${screen.name}`,
        });
      }
    }
  }
  return results.slice(0, MAX_SEARCH_RESULTS);
}

/** Moves the active option one step, wrapping at both ends; -1 when there is none. */
export function stepActiveIndex(current: number, step: -1 | 1, count: number): number {
  return count === 0 ? -1 : (current + step + count) % count;
}
