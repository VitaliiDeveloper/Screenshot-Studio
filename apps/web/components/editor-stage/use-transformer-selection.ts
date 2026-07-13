// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, type RefObject } from "react";
import type Konva from "konva";
import type { Project } from "@screenshot-studio/core/model";
import type { SelectionRef } from "../../lib/editor-selection";

function nodeSelectionKey(screenId: string, elementId: string): string {
  return `${screenId}\u0000${elementId}`;
}

export function useTransformerSelection({
  transformerRef,
  nodeRefs,
  canEdit,
  editingText,
  project,
  selectedItems,
}: {
  transformerRef: RefObject<Konva.Transformer | null>;
  nodeRefs: RefObject<Map<string, Konva.Node>>;
  canEdit: boolean;
  editingText: boolean;
  project: Project | null;
  selectedItems: readonly SelectionRef[];
}) {
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const nodes = canEdit && !editingText
      ? selectedItems
        .map((selection) => nodeRefs.current.get(nodeSelectionKey(selection.screenId, selection.elementId)))
        .filter((node): node is Konva.Node => Boolean(node))
      : [];
    transformer.nodes(nodes);
    transformer.forceUpdate();
    transformer.getLayer()?.batchDraw();
  }, [canEdit, editingText, nodeRefs, project, selectedItems, transformerRef]);
}

export { nodeSelectionKey };
