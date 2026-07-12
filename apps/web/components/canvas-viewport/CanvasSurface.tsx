// SPDX-License-Identifier: Apache-2.0
"use client";

import type { HTMLAttributes, ReactNode, RefObject } from "react";
import type {
  CanvasPattern,
  WorkspaceView,
} from "../../lib/editor-workspace";
import { cx } from "../editor-ui";

type PointerHandlers = Pick<
  HTMLAttributes<HTMLDivElement>,
  "onPointerDownCapture" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>;

export function CanvasSurface({
  viewportRef,
  pattern,
  contentWidth,
  contentHeight,
  pointerHandlers,
  view,
  fittedView,
  initialReveal,
  transitioning,
  panning,
  canPan,
  children,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  pattern: CanvasPattern;
  contentWidth: number;
  contentHeight: number;
  pointerHandlers: PointerHandlers;
  view: WorkspaceView;
  fittedView: WorkspaceView;
  initialReveal: "pending" | "running" | "idle";
  transitioning: boolean;
  panning: boolean;
  canPan: boolean;
  children: ReactNode;
}) {
  // Keep the surface contract aligned with the measured workspace even though layout remains
  // content-driven; fit owns the dimensions and the DOM structure stays unchanged.
  void contentWidth;
  void contentHeight;

  return (
    <div
      ref={viewportRef}
      data-view={view}
      data-fitted-view={fittedView}
      data-initial-reveal={initialReveal}
      data-view-transition={transitioning ? "running" : "idle"}
      data-pattern={pattern}
      data-testid="canvas-viewport"
      className={cx(
        "workspace-canvas absolute inset-0 overflow-auto overscroll-contain",
        panning ? "cursor-grabbing select-none" : canPan ? "cursor-grab" : "cursor-default",
      )}
      {...pointerHandlers}
    >
      {children}
    </div>
  );
}
