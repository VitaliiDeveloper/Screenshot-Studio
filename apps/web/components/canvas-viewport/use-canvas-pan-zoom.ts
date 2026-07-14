// SPDX-License-Identifier: Apache-2.0
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MutableRefObject,
  type RefObject,
} from "react";
import { clampZoom, type WorkspaceTool } from "../../lib/editor-workspace";
import {
  clientToViewportPoint,
  nextAnchoredScroll,
  type ClientPoint,
} from "./canvas-viewport-model";

const WHEEL_ZOOM_SENSITIVITY = 0.002;

export interface CanvasPanZoomInput {
  viewportRef: RefObject<HTMLDivElement | null>;
  zoomRef: MutableRefObject<number>;
  zoom: number;
  tool: WorkspaceTool;
  leftInset: number;
  rightInset: number;
  onZoomChange: (zoom: number) => void;
}

type PointerHandlers = Pick<
  HTMLAttributes<HTMLDivElement>,
  "onPointerDownCapture" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>;

export function useCanvasPanZoom({
  viewportRef,
  zoomRef,
  zoom,
  tool,
  leftInset,
  rightInset,
  onZoomChange,
}: CanvasPanZoomInput): {
  spacePressed: boolean;
  panning: boolean;
  zoomAt: (value: number, clientPoint?: ClientPoint) => void;
  pointerHandlers: PointerHandlers;
} {
  const panRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom, zoomRef]);

  const zoomAt = useCallback((nextValue: number, clientPoint?: ClientPoint) => {
    const viewport = viewportRef.current;
    const previous = zoomRef.current;
    const next = clampZoom(nextValue);
    if (!viewport || next === previous) return;

    const visibleWidth = Math.max(1, viewport.clientWidth - leftInset - rightInset);
    const anchor = clientPoint
      ? clientToViewportPoint(viewport.getBoundingClientRect(), clientPoint)
      : { x: leftInset + visibleWidth / 2, y: viewport.clientHeight / 2 };
    const nextScroll = nextAnchoredScroll({
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      anchor,
      previousZoom: previous,
      nextZoom: next,
    });

    zoomRef.current = next;
    onZoomChange(next);
    requestAnimationFrame(() => {
      viewport.scrollLeft = nextScroll.scrollLeft;
      viewport.scrollTop = nextScroll.scrollTop;
    });
  }, [leftInset, onZoomChange, rightInset, viewportRef, zoomRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAt(
        zoomRef.current * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY),
        { x: event.clientX, y: event.clientY },
      );
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [viewportRef, zoomAt, zoomRef]);

  useEffect(() => {
    const isInteractive = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return Boolean(target.closest(
        "button, a, input, textarea, select, summary, [role='button'], [role='menuitem'], [contenteditable='true']",
      ));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isInteractive(event.target)) return;
      event.preventDefault();
      setSpacePressed(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePressed(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const endPan = useCallback<NonNullable<PointerHandlers["onPointerUp"]>>((event) => {
    const viewport = viewportRef.current;
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    if (viewport?.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
  }, [viewportRef]);

  const pointerHandlers: PointerHandlers = {
    onPointerDownCapture: (event) => {
      const viewport = viewportRef.current;
      if (!viewport || (tool !== "hand" && !spacePressed)) return;
      event.preventDefault();
      event.stopPropagation();
      viewport.setPointerCapture(event.pointerId);
      panRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      setPanning(true);
    },
    onPointerMove: (event) => {
      const viewport = viewportRef.current;
      const pan = panRef.current;
      if (!viewport || !pan || pan.pointerId !== event.pointerId) return;
      viewport.scrollLeft = pan.left - (event.clientX - pan.x);
      viewport.scrollTop = pan.top - (event.clientY - pan.y);
    },
    onPointerUp: endPan,
    onPointerCancel: endPan,
  };

  return { spacePressed, panning, zoomAt, pointerHandlers };
}
