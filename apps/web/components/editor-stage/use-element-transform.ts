// SPDX-License-Identifier: Apache-2.0
"use client";

import { useRef, type RefObject } from "react";
import type Konva from "konva";
import type { Element } from "@screenshot-studio/core/model";
import type { CommonElementPatch } from "@web/lib/editor/editor-element-patch.js";
import { isSelected, type SelectionRef } from "@web/lib/editor/editor-selection.js";
import { snapElementDrag, type SnapGuide } from "@web/lib/editor/editor-snapping.js";
import type { StageProjection } from "./stage-model.js";
import { transformedDimensions } from "./element-transform-model.js";
import { nodeSelectionKey } from "./use-transformer-selection.js";

export interface ElementTransformInput {
  projections: readonly StageProjection[];
  selectedItems: readonly SelectionRef[];
  zoom: number;
  stageSize: { width: number; height: number };
  nodeRefs: RefObject<Map<string, Konva.Node>>;
  transformerRef: RefObject<Konva.Transformer | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
  getLiveElement: (screenId: string, elementId: string) => Element | undefined;
  patchElement: (screenId: string, element: Element, patch: CommonElementPatch) => void;
  moveSelected: (delta: { x: number; y: number }) => void;
}

export function useElementTransform({
  projections,
  selectedItems,
  zoom,
  stageSize,
  nodeRefs,
  transformerRef,
  wrapperRef,
  getLiveElement,
  patchElement,
  moveSelected,
}: ElementTransformInput) {
  const verticalGuideRef = useRef<Konva.Line>(null);
  const horizontalGuideRef = useRef<Konva.Line>(null);

  const showSnapGuides = (guides: readonly SnapGuide[]) => {
    const vertical = guides.find((guide) => guide.axis === "x");
    const horizontal = guides.find((guide) => guide.axis === "y");
    const verticalNode = verticalGuideRef.current;
    const horizontalNode = horizontalGuideRef.current;
    if (verticalNode) {
      verticalNode.points([vertical?.position ?? 0, 0, vertical?.position ?? 0, stageSize.height]);
      verticalNode.visible(Boolean(vertical));
    }
    if (horizontalNode) {
      horizontalNode.points([0, horizontal?.position ?? 0, stageSize.width, horizontal?.position ?? 0]);
      horizontalNode.visible(Boolean(horizontal));
    }
    const wrapper = wrapperRef.current;
    if (wrapper) {
      if (vertical) wrapper.dataset.snapGuideX = String(vertical.position);
      else delete wrapper.dataset.snapGuideX;
      if (horizontal) wrapper.dataset.snapGuideY = String(horizontal.position);
      else delete wrapper.dataset.snapGuideY;
    }
    verticalNode?.getLayer()?.batchDraw();
  };

  const clearSnapGuides = () => showSnapGuides([]);

  const onDragMove = (ownerScreenId: string, id: string) => (
    event: Konva.KonvaEventObject<DragEvent>,
  ) => {
    const element = getLiveElement(ownerScreenId, id);
    if (!element || element.locked) return;
    const candidate = { screenId: ownerScreenId, elementId: id };
    if (selectedItems.length > 1 && isSelected(selectedItems, candidate)) {
      clearSnapGuides();
      const delta = { x: event.target.x() - element.x, y: event.target.y() - element.y };
      for (const selection of selectedItems) {
        if (selection.screenId === ownerScreenId && selection.elementId === id) continue;
        const selected = getLiveElement(selection.screenId, selection.elementId);
        const node = nodeRefs.current.get(nodeSelectionKey(selection.screenId, selection.elementId));
        if (selected && node && !selected.locked) {
          node.position({ x: selected.x + delta.x, y: selected.y + delta.y });
        }
      }
      event.target.getLayer()?.batchDraw();
      return;
    }
    const result = snapElementDrag({
      element,
      ownerScreenId,
      position: { x: event.target.x(), y: event.target.y() },
      projections,
      stage: stageSize,
      zoom,
    });
    event.target.position(result.position);
    showSnapGuides(result.guides);
  };

  const onDragEnd = (ownerScreenId: string, id: string) => (
    event: Konva.KonvaEventObject<DragEvent>,
  ) => {
    clearSnapGuides();
    const element = getLiveElement(ownerScreenId, id);
    if (!element || element.locked) return;
    if (selectedItems.length > 1 && isSelected(selectedItems, { screenId: ownerScreenId, elementId: id })) {
      moveSelected({ x: event.target.x() - element.x, y: event.target.y() - element.y });
      return;
    }
    patchElement(ownerScreenId, element, { x: event.target.x(), y: event.target.y() });
  };

  const onTransformEnd = (ownerScreenId: string, id: string) => (
    event: Konva.KonvaEventObject<Event>,
  ) => {
    clearSnapGuides();
    const node = event.target;
    const element = getLiveElement(ownerScreenId, id);
    if (!element || element.locked) {
      node.position({ x: element?.x ?? node.x(), y: element?.y ?? node.y() });
      node.rotation(element?.rotation ?? node.rotation());
      node.width(element?.width ?? node.width());
      node.height(element?.height ?? node.height());
      node.scale({ x: 1, y: 1 });
      transformerRef.current?.forceUpdate();
      node.getLayer()?.batchDraw();
      return;
    }
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scale({ x: 1, y: 1 });
    patchElement(ownerScreenId, element, {
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      ...transformedDimensions(element, scaleX, scaleY),
    });
  };

  return {
    verticalGuideRef,
    horizontalGuideRef,
    onDragMove,
    onDragEnd,
    onTransformEnd,
  };
}
