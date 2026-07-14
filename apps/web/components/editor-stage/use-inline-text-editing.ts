// SPDX-License-Identifier: Apache-2.0
"use client";

import { useRef, useState } from "react";
import type { Element } from "@screenshot-studio/core/model";
import type { StageProjection } from "./stage-model.js";
import { deriveInlineTextStyle } from "./inline-text-editing-model.js";

export interface InlineTextEditingState {
  screenId: string;
  id: string;
  value: string;
}

export interface InlineTextEditingInput {
  projections: readonly StageProjection[];
  baseX: number;
  zoom: number;
  canEdit: boolean;
  getLiveElement: (screenId: string, elementId: string) => Element | undefined;
  selectElement: (screenId: string, elementId: string) => void;
  commitText: (screenId: string, elementId: string, value: string) => void;
}

export function useInlineTextEditing({
  projections,
  baseX,
  zoom,
  canEdit,
  getLiveElement,
  selectElement,
  commitText,
}: InlineTextEditingInput) {
  const [editing, setEditing] = useState<InlineTextEditingState | null>(null);
  const endingRef = useRef(false);
  const editingProjection = editing
    ? projections.find((projection) => projection.screen.id === editing.screenId)
    : undefined;
  const editingElement = editing && canEdit
    ? editingProjection?.screen.elements.find(
      (element): element is Extract<Element, { type: "text" }> => (
        element.id === editing.id && element.type === "text"
      ),
    )
    : undefined;
  const style = editingElement && editingProjection
    ? deriveInlineTextStyle({
      element: editingElement,
      projection: {
        x: editingProjection.x,
        y: editingProjection.y,
        direction: editingProjection.screen.direction,
      },
      baseX,
      zoom,
    })
    : undefined;

  const finishEditing = (save: boolean) => {
    if (!editing || endingRef.current) return;
    endingRef.current = true;
    if (save && !getLiveElement(editing.screenId, editing.id)?.locked) {
      commitText(editing.screenId, editing.id, editing.value);
    }
    setEditing(null);
    queueMicrotask(() => { endingRef.current = false; });
  };

  const beginTextEditing = (
    screenId: string,
    element: Extract<Element, { type: "text" }>,
    value: string,
  ) => {
    if (!canEdit || element.locked) return;
    endingRef.current = false;
    selectElement(screenId, element.id);
    setEditing({ screenId, id: element.id, value });
  };

  const setValue = (value: string) => {
    if (editing) setEditing({ ...editing, value });
  };

  return {
    editing,
    editingProjection,
    editingElement,
    style,
    beginTextEditing,
    finishEditing,
    setValue,
  };
}
