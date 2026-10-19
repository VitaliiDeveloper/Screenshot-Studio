// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, type RefObject } from "react";
import type { WorkspaceView } from "@web/lib/editor/editor-workspace";
import { activeArtboardScrollBehavior } from "./canvas-viewport-model";

export interface ActiveArtboardScrollInput {
  viewportRef: RefObject<HTMLDivElement | null>;
  activeScreenId: string | null;
  view: WorkspaceView;
  leftInset: number;
  rightInset: number;
}

export function useActiveArtboardScroll({
  viewportRef,
  activeScreenId,
  view,
  leftInset,
  rightInset,
}: ActiveArtboardScrollInput): void {
  useEffect(() => {
    if (view !== "overview" || !activeScreenId) return;
    const id = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const target = Array.from(
        viewport.querySelectorAll<HTMLElement>("[data-artboard-screen-id]"),
      ).find((element) => element.dataset.artboardScreenId === activeScreenId);
      if (!target) return;

      const viewportRect = viewport.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const visibleLeft = viewportRect.left + leftInset;
      const visibleRight = viewportRect.right - rightInset;
      const fullyVisible = targetRect.left >= visibleLeft
        && targetRect.right <= visibleRight
        && targetRect.top >= viewportRect.top
        && targetRect.bottom <= viewportRect.bottom;
      if (fullyVisible) return;

      const visibleWidth = Math.max(1, viewport.clientWidth - leftInset - rightInset);
      const targetCenterX = viewport.scrollLeft + targetRect.left - viewportRect.left + targetRect.width / 2;
      const targetCenterY = viewport.scrollTop + targetRect.top - viewportRect.top + targetRect.height / 2;
      viewport.scrollTo({
        left: targetCenterX - leftInset - visibleWidth / 2,
        top: targetCenterY - viewport.clientHeight / 2,
        behavior: activeArtboardScrollBehavior({
          leftInset,
          rightInset,
          reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        }),
      });
    });
    return () => cancelAnimationFrame(id);
  }, [activeScreenId, leftInset, rightInset, view, viewportRef]);
}
