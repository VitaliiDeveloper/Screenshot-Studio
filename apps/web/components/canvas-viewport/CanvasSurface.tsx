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
  pointerHandlers,
  view,
  fittedView,
  initialReveal,
  transitioning,
  panning,
  canPan,
  onBlankClick,
  children,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  pattern: CanvasPattern;
  pointerHandlers: PointerHandlers;
  view: WorkspaceView;
  fittedView: WorkspaceView;
  initialReveal: "pending" | "running" | "idle";
  transitioning: boolean;
  panning: boolean;
  canPan: boolean;
  onBlankClick?: () => void;
  children: ReactNode;
}) {
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
      onClick={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement) || target.closest("canvas, button, input, select, textarea, [role='button']")) return;
        onBlankClick?.();
      }}
      {...pointerHandlers}
    >
      {children}
    </div>
  );
}
