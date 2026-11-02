// SPDX-License-Identifier: Apache-2.0
"use client";

import { Group, Layer, Rect } from "react-konva";
import { CircleAlert } from "lucide-react";
import { applyTextFit } from "@web/lib/editor/editor-text-fit";
import { elementLabel } from "@web/lib/panel-helpers";
import type { StageColors } from "./stage-colors";
import type { TextOverflowMark } from "./text-overflow-model";

export function TextOverflowLayer({
  visibleOverflowMarks,
  stageColors,
  zoom,
}: {
  visibleOverflowMarks: readonly TextOverflowMark[];
  stageColors: StageColors;
  zoom: number;
}) {
  return (
    // A separate layer keeps editor marks out of the artwork canvas that parity captures.
    <Layer listening={false}>
      {visibleOverflowMarks.map((mark) => (
        <Group key={`overflow-${mark.screenId}-${mark.element.id}`} {...mark.origin} listening={false}>
          <Group x={mark.parent?.x ?? 0} y={mark.parent?.y ?? 0} rotation={mark.parent?.rotation ?? 0}>
            <Group x={mark.element.x} y={mark.element.y} rotation={mark.element.rotation}>
              <Rect
                width={mark.element.width}
                height={mark.element.height}
                stroke={stageColors.overflow}
                strokeWidth={2 / zoom}
              />
              <Rect
                width={mark.element.width}
                height={mark.contentHeight}
                stroke={stageColors.overflow}
                strokeWidth={1 / zoom}
                dash={[6 / zoom, 4 / zoom]}
              />
            </Group>
          </Group>
        </Group>
      ))}
    </Layer>
  );
}

export function TextOverflowFitHints({
  visibleOverflowMarks,
  toolbarMark,
  zoom,
}: {
  visibleOverflowMarks: readonly TextOverflowMark[];
  toolbarMark: TextOverflowMark | undefined;
  zoom: number;
}) {
  return visibleOverflowMarks.filter((mark) => mark !== toolbarMark).map((mark) => (
    <button
      key={`fit-${mark.screenId}-${mark.element.id}`}
      type="button"
      disabled={mark.fitSize === null}
      aria-label={`Fit text: ${elementLabel(mark.element)}`}
      title={mark.fitSize === null
        ? "The text overflows even at 1 px. Resize the layer instead."
        : "Text overflows its box. Fit text sets the largest size that fits, on this screen only."}
      className="absolute z-10 flex items-center gap-1 whitespace-nowrap rounded-md border border-[var(--editor-color-warning-border)] bg-[var(--editor-color-warning-surface)] px-2 py-0.5 text-[11px] font-semibold text-[color:var(--editor-color-warning-text)] shadow-sm hover:bg-[var(--editor-color-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] disabled:cursor-not-allowed disabled:opacity-70"
      style={{ left: mark.hint.x * zoom, top: mark.hint.y * zoom + 8 }}
      onClick={() => {
        if (mark.fitSize !== null) applyTextFit(mark.screenId, mark.element.id, mark.fitSize);
      }}
    >
      <CircleAlert size={12} strokeWidth={2.2} aria-hidden="true" />
      Fit text
    </button>
  ));
}
