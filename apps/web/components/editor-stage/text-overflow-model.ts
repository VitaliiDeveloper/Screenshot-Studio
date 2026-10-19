// SPDX-License-Identifier: Apache-2.0
import type { GroupElement, LayoutDirection, TextElement } from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import type { StageProjection } from "./stage-model";

export interface TextOverflowMark {
  screenId: string;
  element: TextElement;
  /** The group a nested text layer sits in; its children are positioned in group space. */
  parent: GroupElement | undefined;
  /** Owner screen origin in stage px. */
  origin: { x: number; y: number };
  /** Height the text would take without the box limit: the dashed zone. */
  contentHeight: number;
  fitSize: number | null;
  /** Bottom-left corner of the layer box in stage px, where the Fit text hint sits. */
  hint: { x: number; y: number };
}

export interface TextMeasure {
  contentHeight: (element: TextElement, direction: LayoutDirection) => number;
  fitSize: (element: TextElement, direction: LayoutDirection) => number | null;
}

function rotate(point: { x: number; y: number }, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

/**
 * Canvas marks for the text layers Issues reports as overflowing. Overflow itself is never
 * re-measured here: the Issues list is the single source, so the canvas and Issues always agree.
 */
export function deriveTextOverflowMarks({
  projections,
  baseX,
  issues,
  measure,
}: {
  projections: readonly StageProjection[];
  baseX: number;
  issues: readonly ProjectIssue[];
  measure: TextMeasure;
}): TextOverflowMark[] {
  const overflowing = new Set(issues.flatMap((issue) => (
    issue.kind === "text-overflow" ? [`${issue.screenId}:${issue.elementId}`] : []
  )));
  if (overflowing.size === 0) return [];
  return projections.flatMap(({ screen, x, y }) => {
    const origin = { x: x + baseX, y };
    const mark = (element: TextElement, parent: GroupElement | undefined): TextOverflowMark => {
      const corner = rotate({ x: 0, y: element.height }, element.rotation);
      let local = { x: element.x + corner.x, y: element.y + corner.y };
      if (parent) {
        const inParent = rotate(local, parent.rotation);
        local = { x: parent.x + inParent.x, y: parent.y + inParent.y };
      }
      return {
        screenId: screen.id,
        element,
        parent,
        origin,
        contentHeight: measure.contentHeight(element, screen.direction),
        fitSize: measure.fitSize(element, screen.direction),
        hint: { x: origin.x + local.x, y: origin.y + local.y },
      };
    };
    const reported = (element: { id: string; visible: boolean }) => (
      element.visible && overflowing.has(`${screen.id}:${element.id}`)
    );
    return screen.elements.flatMap((element) => {
      if (element.type === "text") return reported(element) ? [mark(element, undefined)] : [];
      if (element.type !== "group" || !element.visible) return [];
      return element.children.flatMap((child) => (
        child.type === "text" && reported(child) ? [mark(child, element)] : []
      ));
    });
  });
}
