// SPDX-License-Identifier: Apache-2.0
import type { DesignLayout, Element, ElementBounds } from "@screenshot-studio/core/model";
import { selectionBounds, type SelectionRef } from "@web/lib/editor/editor-selection";

export interface SelectionOverlay {
  /** Rotation-aware bounds of the selection in stage px; the toolbar sits above, the badge below. */
  bounds: ElementBounds;
  /** "W × H" in artboard px: the layer box for one layer, the selection bounds for several. */
  sizeLabel: string;
}

export function deriveSelectionOverlay({
  layout,
  activeScreenId,
  selectedItems,
  selectedElement,
}: {
  layout: DesignLayout | null;
  activeScreenId: string | null;
  selectedItems: readonly SelectionRef[];
  selectedElement: Element | undefined;
}): SelectionOverlay | null {
  if (!layout || !activeScreenId) return null;
  const bounds = selectionBounds(layout, activeScreenId, selectedItems);
  if (!bounds) return null;
  const single = selectedItems.length === 1 ? selectedElement : undefined;
  const width = single ? single.width : bounds.maxX - bounds.minX;
  const height = single ? single.height : bounds.maxY - bounds.minY;
  return { bounds, sizeLabel: `${Math.round(width)} × ${Math.round(height)}` };
}
