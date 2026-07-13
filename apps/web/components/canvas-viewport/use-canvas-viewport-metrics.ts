// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useMemo, type MutableRefObject, type RefObject } from "react";
import type { Screen } from "@screenshot-studio/core/model";
import {
  ARTBOARD_LABEL_HEIGHT,
  CANVAS_PADDING,
  fitArtboardRowsZoom,
  fitArtboardsZoom,
  OVERVIEW_GAP,
  OVERVIEW_ROW_GAP,
  OUTPUT_FAMILY_LABEL_HEIGHT,
  type WorkspaceOverviewRow,
  type WorkspaceView,
} from "../../lib/editor-workspace";

export interface CanvasViewportMetricsInput {
  viewportRef: RefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<number>;
  screens: readonly Screen[];
  outputRows: readonly WorkspaceOverviewRow[];
  view: WorkspaceView;
  connected: boolean;
  leftInset: number;
  rightInset: number;
  onZoomChange: (zoom: number) => void;
}

export function useCanvasViewportMetrics({
  viewportRef,
  zoomRef,
  screens,
  outputRows,
  view,
  connected,
  leftInset,
  rightInset,
  onZoomChange,
}: CanvasViewportMetricsInput): {
  contentWidth: number;
  contentHeight: number;
  fitLayoutKey: string;
  fit: () => void;
} {
  const contentBounds = useMemo(() => {
    if (screens.length === 0) return { width: 1, height: 1 };
    if (view === "overview" && outputRows.length > 0) {
      return {
        width: Math.max(...outputRows.map((row) =>
          row.screens.reduce((sum, screen) => sum + screen.artboard.width, 0),
        )),
        height: outputRows.reduce((sum, row) =>
          sum + Math.max(...row.screens.map((screen) => screen.artboard.height)),
        0),
      };
    }
    return {
      width: screens.reduce((sum, screen) => sum + screen.artboard.width, 0),
      height: Math.max(...screens.map((screen) => screen.artboard.height)),
    };
  }, [outputRows, screens, view]);
  const contentWidth = contentBounds.width;
  const contentHeight = contentBounds.height;
  const fitLayoutKey = useMemo(() => JSON.stringify({
    view,
    connected,
    leftInset,
    rightInset,
    screens: screens.map((screen) => [
      screen.id,
      screen.artboard.width,
      screen.artboard.height,
    ]),
    rows: outputRows.map((row) => row.screens.map((screen) => [
      screen.id,
      screen.artboard.width,
      screen.artboard.height,
    ])),
  }), [connected, leftInset, outputRows, rightInset, screens, view]);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const viewportSize = {
      width: Math.max(1, viewport.clientWidth - leftInset - rightInset),
      height: viewport.clientHeight,
    };
    if (view === "overview" && outputRows.length > 0) {
      const next = fitArtboardRowsZoom(
        viewportSize,
        outputRows.map((row) => row.screens.map((screen) => screen.artboard)),
        {
          columnGap: connected ? 0 : OVERVIEW_GAP,
          rowGap: OVERVIEW_ROW_GAP,
          padding: CANVAS_PADDING,
          labelHeight: ARTBOARD_LABEL_HEIGHT + OUTPUT_FAMILY_LABEL_HEIGHT,
        },
      );
      zoomRef.current = next;
      onZoomChange(next);
      requestAnimationFrame(() => viewport.scrollTo({ left: 0, top: 0 }));
      return;
    }
    const next = fitArtboardsZoom(
      viewportSize,
      Array.from({ length: screens.length }, (_, index) => ({
        width: index === 0 ? contentWidth : 0,
        height: contentHeight,
      })),
      {
        gap: 0,
        padding: CANVAS_PADDING,
        labelHeight: ARTBOARD_LABEL_HEIGHT,
      },
    );
    zoomRef.current = next;
    onZoomChange(next);
    requestAnimationFrame(() => {
      viewport.scrollTo({ left: 0, top: 0 });
    });
  }, [connected, contentHeight, contentWidth, leftInset, onZoomChange, outputRows, rightInset, screens.length, view, viewportRef, zoomRef]);

  return { contentWidth, contentHeight, fitLayoutKey, fit };
}
