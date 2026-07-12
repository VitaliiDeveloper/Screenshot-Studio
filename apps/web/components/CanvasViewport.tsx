// SPDX-License-Identifier: Apache-2.0
"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStore } from "zustand";
import { Grid3X3, Grip, Maximize2, Minus, Plus, SquareDashed } from "lucide-react";
import type { ImageCache } from "@screenshot-studio/core/assets";
import type { Screen } from "@screenshot-studio/core/model";
import {
  ARTBOARD_LABEL_HEIGHT,
  CANVAS_PADDING,
  clampZoom,
  fitArtboardRowsZoom,
  fitArtboardsZoom,
  groupScreensByOutput,
  OVERVIEW_GAP,
  OVERVIEW_ROW_GAP,
  OUTPUT_FAMILY_LABEL_HEIGHT,
  workspaceScreenScope,
  type CanvasPattern,
  type WorkspaceTool,
  type WorkspaceView,
} from "../lib/editor-workspace";
import { editorStore } from "../lib/editor-store";
import { EditorStage } from "./EditorStage";
import { cx, editorUi, MenuSelect, type MenuSelectOption } from "./editor-ui";

const canvasPatternOptions: MenuSelectOption<CanvasPattern>[] = [
  { value: "dots", label: "Dots", icon: Grip },
  { value: "grid", label: "Grid", icon: Grid3X3 },
  { value: "none", label: "None", icon: SquareDashed },
];
export function CanvasViewport({
  images,
  zoom,
  view,
  tool,
  pattern,
  onZoomChange,
  onPatternChange,
  leftInset = 0,
  rightInset = 0,
  controlsHidden = false,
}: {
  images: ImageCache;
  zoom: number;
  view: WorkspaceView;
  tool: WorkspaceTool;
  pattern: CanvasPattern;
  onZoomChange: (zoom: number) => void;
  onPatternChange: (pattern: CanvasPattern) => void;
  leftInset?: number;
  rightInset?: number;
  controlsHidden?: boolean;
}) {
  const project = useStore(editorStore, (state) => state.project);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastFitLayoutRef = useRef<string | null>(null);
  const previousViewRef = useRef(view);
  const initialRevealStartedRef = useRef(false);
  const initialRevealRef = useRef<Animation | null>(null);
  const initialRevealFrameRef = useRef<number | null>(null);
  const transitionRef = useRef<Animation | null>(null);
  const transitionFrameRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);
  const [fittedView, setFittedView] = useState<WorkspaceView>(view);
  const [initialReveal, setInitialReveal] = useState<"pending" | "running" | "idle">("pending");
  const [transitioning, setTransitioning] = useState(false);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const activeScreen = project?.screens.find((screen) => screen.id === activeScreenId) ?? project?.screens[0];
  const screens = useMemo(
    () => {
      if (!project || !activeScreen) return [];
      if (view !== "overview") return [activeScreen];
      return workspaceScreenScope(project, activeScreen);
    },
    [activeScreen, project, view],
  );
  const connectedOverview = project?.mode === "connected" && view === "overview";
  const outputRows = useMemo(() => groupScreensByOutput(screens), [screens]);

  const contentBounds = useMemo(() => {
    if (screens.length === 0) return { width: 1, height: 1 };
    if (view === "overview" && !connectedOverview && outputRows.length > 1) {
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
  }, [connectedOverview, outputRows, screens, view]);
  const contentWidth = contentBounds.width;
  const contentHeight = contentBounds.height;
  const fitLayoutKey = useMemo(() => JSON.stringify({
    view,
    connectedOverview,
    leftInset,
    rightInset,
    rows: outputRows.map((row) => row.screens.map((screen) => [
      screen.id,
      screen.artboard.width,
      screen.artboard.height,
    ])),
  }), [connectedOverview, leftInset, outputRows, rightInset, view]);

  const zoomAt = useCallback((nextValue: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current;
    const previous = zoomRef.current;
    const next = clampZoom(nextValue);
    if (!viewport || next === previous) return;

    const rect = viewport.getBoundingClientRect();
    const visibleWidth = Math.max(1, viewport.clientWidth - leftInset - rightInset);
    const localX = clientX === undefined ? leftInset + visibleWidth / 2 : clientX - rect.left;
    const localY = clientY === undefined ? viewport.clientHeight / 2 : clientY - rect.top;
    const anchorX = viewport.scrollLeft + localX;
    const anchorY = viewport.scrollTop + localY;
    const ratio = next / previous;

    zoomRef.current = next;
    onZoomChange(next);
    requestAnimationFrame(() => {
      viewport.scrollLeft = anchorX * ratio - localX;
      viewport.scrollTop = anchorY * ratio - localY;
    });
  }, [leftInset, onZoomChange, rightInset]);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const viewportSize = {
      width: Math.max(1, viewport.clientWidth - leftInset - rightInset),
      height: viewport.clientHeight,
    };
    if (view === "overview" && !connectedOverview && outputRows.length > 1) {
      const next = fitArtboardRowsZoom(
        viewportSize,
        outputRows.map((row) => row.screens.map((screen) => screen.artboard)),
        {
          columnGap: OVERVIEW_GAP,
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
    const count = screens.length;
    const next = fitArtboardsZoom(
      viewportSize,
      Array.from({ length: count }, (_, index) => ({
        width: index === 0 ? contentWidth : 0,
        height: contentHeight,
      })),
      {
        gap: view === "overview" && !connectedOverview ? OVERVIEW_GAP : 0,
        padding: CANVAS_PADDING,
        labelHeight: ARTBOARD_LABEL_HEIGHT,
      },
    );
    zoomRef.current = next;
    onZoomChange(next);
    requestAnimationFrame(() => {
      viewport.scrollTo({ left: 0, top: 0 });
    });
  }, [connectedOverview, contentHeight, contentWidth, leftInset, onZoomChange, outputRows, rightInset, screens.length, view]);

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
  }, [fit, view]);

  useLayoutEffect(() => {
    if (previousViewRef.current === view) return;
    previousViewRef.current = view;

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
          { opacity: 0.88, transform: view === "overview" ? "scale(1.025)" : "scale(0.975)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
      transitionRef.current = animation;
      animation.finished.then(() => {
        if (transitionRef.current !== animation) return;
        transitionRef.current = null;
        content.style.removeProperty("transform-origin");
        setTransitioning(false);
      }).catch(() => undefined);
    });
  }, [activeScreenId, fit, view]);

  useEffect(() => () => {
    initialRevealRef.current?.cancel();
    transitionRef.current?.cancel();
    if (initialRevealFrameRef.current !== null) cancelAnimationFrame(initialRevealFrameRef.current);
    if (transitionFrameRef.current !== null) cancelAnimationFrame(transitionFrameRef.current);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAt(zoomRef.current * Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

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

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
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
  };

  const continuePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const pan = panRef.current;
    if (!viewport || !pan || pan.pointerId !== event.pointerId) return;
    viewport.scrollLeft = pan.left - (event.clientX - pan.x);
    viewport.scrollTop = pan.top - (event.clientY - pan.y);
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    setPanning(false);
    if (viewport?.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  };

  useEffect(() => {
    if (lastFitLayoutRef.current === fitLayoutKey) return;
    lastFitLayoutRef.current = fitLayoutKey;
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
  }, [fit, fitLayoutKey]);

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
        behavior: "smooth",
      });
    });
    return () => cancelAnimationFrame(id);
  }, [activeScreenId, leftInset, rightInset, view]);

  if (!project || screens.length === 0) {
    return <section className="min-w-0 flex-1 bg-slate-50" />;
  }

  const renderIsolatedScreen = (screen: Screen) => {
    const active = screen.id === activeScreenId;
    const previewWidth = screen.artboard.width * zoom;
    const metadata = `${screen.device} · ${screen.locale}${screen.storeTargetId ? ` · ${screen.storeTargetId}` : ""}`;
    return (
      <div
        key={screen.id}
        data-testid="artboard-preview-item"
        data-artboard-screen-id={screen.id}
        className="min-w-0 shrink-0"
        style={{ width: previewWidth }}
      >
        <div className={cx(
          "mb-2 flex h-5 min-w-0 items-center overflow-hidden text-xs font-medium leading-5",
          active ? "text-blue-700" : "text-slate-500",
        )} data-testid="artboard-preview-label">
          <span
            data-testid="artboard-preview-name"
            className="min-w-0 shrink truncate whitespace-nowrap"
            title={screen.name}
          >
            {screen.name}
          </span>
        </div>
        <div
          role={!active && view === "overview" ? "button" : undefined}
          tabIndex={!active && view === "overview" ? 0 : undefined}
          aria-label={!active && view === "overview" ? `Edit ${screen.name}` : undefined}
          data-screen-id={screen.id}
          className={cx(
            "relative overflow-hidden bg-white shadow-[0_8px_28px_rgba(15,23,42,0.12)]",
            active ? "ring-2 ring-blue-600 ring-offset-2 ring-offset-slate-50" : "ring-1 ring-slate-300",
            !active && view === "overview" && "cursor-pointer transition-shadow hover:shadow-[0_12px_34px_rgba(15,23,42,0.16)]",
          )}
          onClick={() => {
            if (!active && view === "overview") editorStore.getState().selectScreen(screen.id);
          }}
          onKeyDown={(event) => {
            if (!active && view === "overview" && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              editorStore.getState().selectScreen(screen.id);
            }
          }}
        >
          <EditorStage
            images={images}
            zoom={zoom}
            screenId={screen.id}
            interactive={project.mode === "connected" ? false : active}
          />
        </div>
        <div
          className="mt-2 flex h-5 min-w-0 items-center overflow-hidden text-[10px] font-normal leading-5 text-slate-400"
          data-testid="artboard-preview-caption"
        >
          <span
            data-testid="artboard-preview-metadata"
            className="min-w-0 truncate whitespace-nowrap"
            title={metadata}
          >
            {metadata}
          </span>
        </div>
      </div>
    );
  };

  return (
    <section className="relative min-w-0 flex-1 overflow-hidden bg-slate-50" aria-label="Canvas workspace">
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
          panning ? "cursor-grabbing select-none" : tool === "hand" || spacePressed ? "cursor-grab" : "cursor-default",
        )}
        onPointerDownCapture={beginPan}
        onPointerMove={continuePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div
          className="flex min-h-full w-max min-w-full py-20"
          style={{
            paddingLeft: CANVAS_PADDING + leftInset,
            paddingRight: CANVAS_PADDING + rightInset,
          }}
        >
          <div
            ref={contentRef}
            style={initialReveal === "idle" ? undefined : { opacity: 0 }}
            className={cx(
              "m-auto",
              connectedOverview || view === "focus" ? "flex items-start" : "flex flex-col items-start",
            )}
            data-testid={view === "overview" ? "overview-artboards" : "focus-artboard"}
          >
            {connectedOverview ? (
              <div className="shrink-0" data-testid="connected-artboards">
                <div className="mb-2 flex text-xs font-medium">
                  {screens.map((screen) => (
                    <div
                      key={screen.id}
                      className={cx(
                        "flex shrink-0 items-center gap-2 px-1",
                        screen.id === activeScreenId ? "text-blue-700" : "text-slate-500",
                      )}
                      style={{ width: screen.artboard.width * zoom }}
                    >
                      <span className="truncate">{screen.name}</span>
                      <span className="shrink-0 text-[10px] font-normal text-slate-400">
                        {screen.device} · {screen.locale}{screen.storeTargetId ? ` · ${screen.storeTargetId}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="relative overflow-hidden bg-white shadow-[0_8px_28px_rgba(15,23,42,0.12)] ring-1 ring-slate-300">
                  <EditorStage
                    images={images}
                    zoom={zoom}
                    screenId={activeScreenId ?? undefined}
                    connectedOverview
                    interactive
                  />
                </div>
              </div>
            ) : view === "overview" && outputRows.length > 1 ? (
              <div className="flex flex-col gap-14" data-testid="overview-output-families">
                {outputRows.map((row) => (
                  <section key={row.key} aria-label={`${row.label} output row`}>
                    <div className="mb-3 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      <span>{row.label}</span>
                      <span className="h-px min-w-12 flex-1 bg-slate-200" aria-hidden="true" />
                    </div>
                    <div className="flex items-start gap-12">
                      {row.screens.map(renderIsolatedScreen)}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className={cx("flex items-start", view === "overview" ? "gap-12" : "gap-0")}>
                {screens.map(renderIsolatedScreen)}
              </div>
            )}
          </div>
        </div>
      </div>

      {!controlsHidden ? (
        <div className="absolute top-3 z-30" style={{ right: rightInset + 12 }}>
          <MenuSelect
            ariaLabel={`Canvas background: ${canvasPatternOptions.find((option) => option.value === pattern)?.label ?? "Dots"}`}
            menuLabel="Canvas background"
            value={pattern}
            options={canvasPatternOptions}
            onChange={onPatternChange}
            className="min-w-28"
            triggerClassName="h-9 min-w-28 rounded-xl border-slate-200/80 px-2 font-medium text-slate-600"
            menuClassName="w-40"
            showSelectedIcon
          />
        </div>
      ) : null}

      {!controlsHidden ? <div
        className="absolute bottom-4 z-20 flex -translate-x-1/2 items-center rounded-xl border border-slate-200 bg-white p-1 shadow-lg shadow-slate-950/10"
        style={{ left: `calc(50% + ${(leftInset - rightInset) / 2}px)` }}
        aria-label="Zoom controls"
      >
        <button type="button" className={editorUi.iconButton} aria-label="Zoom out" onClick={() => zoomAt(zoom - 0.1)}>
          <Minus size={15} strokeWidth={2} />
        </button>
        <button type="button" className="h-8 w-14 rounded-lg text-center text-xs font-semibold tabular-nums text-slate-700 hover:bg-slate-50" onClick={() => zoomAt(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className={editorUi.iconButton} aria-label="Zoom in" onClick={() => zoomAt(zoom + 0.1)}>
          <Plus size={15} strokeWidth={2} />
        </button>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />
        <button type="button" className={editorUi.buttonGhost} onClick={fit}>
          <Maximize2 size={14} strokeWidth={1.9} /> Fit
        </button>
      </div> : null}
    </section>
  );
}
