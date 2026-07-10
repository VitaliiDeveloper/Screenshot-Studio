"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStore } from "zustand";
import { Grid3X3, Grip, Maximize2, Minus, Plus, SquareDashed } from "lucide-react";
import type { ImageCache } from "@screenshot-studio/core/assets";
import {
  ARTBOARD_LABEL_HEIGHT,
  CANVAS_PADDING,
  clampZoom,
  fitArtboardsZoom,
  OVERVIEW_GAP,
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
  const zoomRef = useRef(zoom);
  const panRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const activeScreen = project?.screens.find((screen) => screen.id === activeScreenId) ?? project?.screens[0];
  const activeLocale = activeScreen?.locale;
  const screens = useMemo(
    () => view === "overview"
      ? project?.screens.filter((screen) => screen.locale === activeLocale) ?? []
      : activeScreen ? [activeScreen] : [],
    [activeLocale, activeScreen, project?.screens, view],
  );

  const contentBounds = useMemo(() => {
    if (screens.length === 0) return { width: 1, height: 1 };
    return {
      width: screens.reduce((sum, screen) => sum + screen.artboard.width, 0),
      height: Math.max(...screens.map((screen) => screen.artboard.height)),
    };
  }, [screens]);
  const contentWidth = contentBounds.width;
  const contentHeight = contentBounds.height;

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
    const count = screens.length;
    const next = fitArtboardsZoom(
      {
        width: Math.max(1, viewport.clientWidth - leftInset - rightInset),
        height: viewport.clientHeight,
      },
      Array.from({ length: count }, (_, index) => ({
        width: index === 0 ? contentWidth : 0,
        height: contentHeight,
      })),
      {
        gap: view === "overview" ? OVERVIEW_GAP : 0,
        padding: CANVAS_PADDING,
        labelHeight: ARTBOARD_LABEL_HEIGHT,
      },
    );
    zoomRef.current = next;
    onZoomChange(next);
    requestAnimationFrame(() => {
      viewport.scrollTo({ left: 0, top: 0 });
    });
  }, [contentHeight, contentWidth, leftInset, onZoomChange, rightInset, screens.length, view]);

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
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
  }, [fit, view]);

  if (!project || screens.length === 0) {
    return <section className="min-w-0 flex-1 bg-slate-50" />;
  }

  return (
    <section className="relative min-w-0 flex-1 overflow-hidden bg-slate-50" aria-label="Canvas workspace">
      <div
        ref={viewportRef}
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
          className="flex min-h-full w-max min-w-full items-center justify-center py-20"
          style={{
            paddingLeft: CANVAS_PADDING + leftInset,
            paddingRight: CANVAS_PADDING + rightInset,
          }}
        >
          <div
            className={cx("flex items-start", view === "overview" ? "gap-12" : "gap-0")}
            data-testid={view === "overview" ? "overview-artboards" : "focus-artboard"}
          >
            {screens.map((screen) => {
              const active = screen.id === activeScreenId;
              return (
                <div key={screen.id} className="shrink-0">
                  <div className={cx(
                    "mb-2 flex items-center gap-2 text-xs font-medium",
                    active ? "text-blue-700" : "text-slate-500",
                  )}>
                    <span className="truncate">{screen.name}</span>
                    <span className="text-[10px] font-normal text-slate-400">{screen.device} · {screen.locale}</span>
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
                    <EditorStage images={images} zoom={zoom} screenId={screen.id} interactive={active} />
                  </div>
                </div>
              );
            })}
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
