// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { CanvasMode } from "@screenshot-studio/core/model";
import type { WorkspaceView } from "@web/lib/editor/editor-workspace";
import { canvasTransitionKind, type CanvasTransitionState } from "./layout-transition";

export interface CanvasTransitionsInput {
  contentRef: RefObject<HTMLDivElement | null>;
  layoutId: string | null;
  layoutMode: CanvasMode | null;
  view: WorkspaceView;
  activeScreenId: string | null;
  screens: readonly { id: string }[];
  fit: () => void;
  fitLayoutKey: string;
}

/**
 * Installs every fit before paint and animates the canvas content: the first reveal, then each
 * layout or view change anchored on the active artboard, and each Focus screen switch.
 */
export function useCanvasTransitions({
  contentRef,
  layoutId,
  layoutMode,
  view,
  activeScreenId,
  screens,
  fit,
  fitLayoutKey,
}: CanvasTransitionsInput): {
  fittedView: WorkspaceView;
  initialReveal: "pending" | "running" | "idle";
  transitioning: boolean;
} {
  const lastFitLayoutRef = useRef<string | null>(null);
  const previousCanvasStateRef = useRef<CanvasTransitionState>({
    layoutId,
    layoutMode,
    view,
    activeScreenId,
    screenIds: screens.map((screen) => screen.id),
  });
  const initialRevealStartedRef = useRef(false);
  const initialRevealRef = useRef<Animation | null>(null);
  const initialRevealFrameRef = useRef<number | null>(null);
  const transitionRef = useRef<Animation | null>(null);
  const transitionFrameRef = useRef<number | null>(null);
  const [fittedView, setFittedView] = useState<WorkspaceView>(view);
  const [initialReveal, setInitialReveal] = useState<"pending" | "running" | "idle">("pending");
  const [transitioning, setTransitioning] = useState(false);

  useLayoutEffect(() => {
    if (initialRevealStartedRef.current) return;
    initialRevealStartedRef.current = true;

    // Keep the default zoom invisible, install the first fit, then reveal the settled canvas.
    fit();
    setFittedView(view);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      initialRevealFrameRef.current = requestAnimationFrame(() => {
        initialRevealFrameRef.current = null;
        setInitialReveal("idle");
      });
      return;
    }

    initialRevealFrameRef.current = requestAnimationFrame(() => {
      initialRevealFrameRef.current = null;
      setInitialReveal("running");
      const content = contentRef.current;
      if (!content) {
        setInitialReveal("idle");
        return;
      }
      const animation = content.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: 180, easing: "ease-out", fill: "forwards" },
      );
      initialRevealRef.current = animation;
      animation.finished.then(() => {
        if (initialRevealRef.current !== animation) return;
        initialRevealRef.current = null;
        animation.commitStyles();
        animation.cancel();
        setInitialReveal("idle");
      }).catch(() => undefined);
    });
  }, [contentRef, fit, view]);

  useLayoutEffect(() => {
    const nextState: CanvasTransitionState = {
      layoutId,
      layoutMode,
      view,
      activeScreenId,
      screenIds: screens.map((screen) => screen.id),
    };
    const previousState = previousCanvasStateRef.current;
    const transitionKind = canvasTransitionKind(previousState, nextState);
    previousCanvasStateRef.current = nextState;
    if (transitionKind === "none") return;

    transitionRef.current?.cancel();
    transitionRef.current = null;
    if (transitionFrameRef.current !== null) cancelAnimationFrame(transitionFrameRef.current);
    transitionFrameRef.current = null;

    // Install the destination fit during layout so the stale source zoom is never painted.
    fit();
    setFittedView(view);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    if (transitionKind === "screen") {
      const content = contentRef.current;
      if (!content) return;
      const forward = nextState.screenIds.indexOf(activeScreenId ?? "")
        > nextState.screenIds.indexOf(previousState.activeScreenId ?? "");
      content.style.removeProperty("transform-origin");
      // Start before paint so the incoming artboard is never shown at its settled position first.
      const animation = content.animate(
        [
          { opacity: 0.4, transform: `translateX(${forward ? 48 : -48}px)` },
          { opacity: 1, transform: "translateX(0)" },
        ],
        { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
      transitionRef.current = animation;
      setTransitioning(true);
      animation.finished.then(() => {
        if (transitionRef.current !== animation) return;
        transitionRef.current = null;
        setTransitioning(false);
      }).catch(() => {
        // A cancelled run that nothing replaced (reduced motion, unmount) must not stay running.
        if (transitionRef.current === null && transitionFrameRef.current === null) setTransitioning(false);
      });
      return;
    }

    transitionFrameRef.current = requestAnimationFrame(() => {
      transitionFrameRef.current = null;
      setTransitioning(true);
      const content = contentRef.current;
      if (!content) {
        setTransitioning(false);
        return;
      }

      const activeArtboard = content.querySelector<HTMLElement>(`[data-artboard-screen-id="${CSS.escape(activeScreenId ?? "")}"]`);
      if (activeArtboard) {
        const contentRect = content.getBoundingClientRect();
        const artboardRect = activeArtboard.getBoundingClientRect();
        content.style.transformOrigin = `${artboardRect.left - contentRect.left + artboardRect.width / 2}px ${artboardRect.top - contentRect.top + artboardRect.height / 2}px`;
      } else {
        content.style.transformOrigin = "center center";
      }

      const animation = content.animate(
        [
          transitionKind === "layout"
            ? { opacity: 0.82, transform: "scale(0.985)" }
            : { opacity: 0.88, transform: view === "overview" ? "scale(1.025)" : "scale(0.975)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        {
          duration: transitionKind === "layout" ? 220 : 320,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
      transitionRef.current = animation;
      animation.finished.then(() => {
        if (transitionRef.current !== animation) return;
        transitionRef.current = null;
        content.style.removeProperty("transform-origin");
        setTransitioning(false);
      }).catch(() => {
        if (transitionRef.current === null && transitionFrameRef.current === null) setTransitioning(false);
      });
    });
  }, [activeScreenId, contentRef, fit, layoutId, layoutMode, screens, view]);

  useEffect(() => () => {
    initialRevealRef.current?.cancel();
    transitionRef.current?.cancel();
    if (initialRevealFrameRef.current !== null) cancelAnimationFrame(initialRevealFrameRef.current);
    if (transitionFrameRef.current !== null) cancelAnimationFrame(transitionFrameRef.current);
  }, []);

  useLayoutEffect(() => {
    if (lastFitLayoutRef.current === fitLayoutKey) return;
    lastFitLayoutRef.current = fitLayoutKey;

    // Structural canvas changes (for example adding an output family) must install their new fit
    // before paint. Deferring this to an effect/frame briefly renders the new geometry at the old
    // zoom and makes the canvas visibly jump.
    fit();
  }, [fit, fitLayoutKey]);

  return { fittedView, initialReveal, transitioning };
}
