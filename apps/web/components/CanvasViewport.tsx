// SPDX-License-Identifier: Apache-2.0
"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStore } from "zustand";
import { Grid3X3, Grip, Maximize2, Minus, Plus, SquareDashed } from "lucide-react";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { leadStoreSizeId, type StoreSpecs } from "@screenshot-studio/core/export";
import type { Screen } from "@screenshot-studio/core/model";
import {
  CANVAS_PADDING,
  compactStoreSizeLabel,
  storeOutputLabel,
  workspaceEditingScope,
  workspaceOverviewRows,
  type CanvasPattern,
  type WorkspaceOutputFamily,
  type WorkspaceTool,
  type WorkspaceView,
} from "../lib/editor-workspace";
import { editorStore, selectEditorLayout } from "../lib/editor-store";
import { EditorStage } from "./EditorStage";
import { CanvasSurface } from "./canvas-viewport/CanvasSurface";
import { ConnectedOutputRow } from "./canvas-viewport/ConnectedOutputRow";
import { canvasTransitionKind, type CanvasTransitionState } from "./canvas-viewport/layout-transition";
import { OutputFamilySection } from "./canvas-viewport/OutputFamilySection";
import { ScreenPreviewMetadata, ScreenPreviewTitle } from "./canvas-viewport/ScreenPreviewLabels";
import { useCanvasPanZoom } from "./canvas-viewport/use-canvas-pan-zoom";
import { useCanvasViewportMetrics } from "./canvas-viewport/use-canvas-viewport-metrics";
import { cx, editorUi, MenuSelect, type MenuSelectOption } from "./editor-ui";

const canvasPatternOptions: MenuSelectOption<CanvasPattern>[] = [
  { value: "dots", label: "Dots", icon: Grip },
  { value: "grid", label: "Grid", icon: Grid3X3 },
  { value: "none", label: "None", icon: SquareDashed },
];

interface IsolatedOverviewFamily {
  key: string;
  label: string;
  rows: WorkspaceOutputFamily[];
  editing: boolean;
}

function groupIsolatedOverviewRows(rows: readonly WorkspaceOutputFamily[]): IsolatedOverviewFamily[] {
  const families = new Map<string, IsolatedOverviewFamily>();
  for (const row of rows) {
    const screen = row.screens[0];
    if (!screen) continue;
    const key = `${screen.platform}/${screen.device}`;
    const family = families.get(key) ?? {
      key,
      label: storeOutputLabel(screen.platform, screen.device),
      rows: [],
      editing: false,
    };
    family.rows.push(row);
    family.editing ||= row.editing;
    families.set(key, family);
  }
  return Array.from(families.values());
}

function outputSizeLabel(row: WorkspaceOutputFamily, specs: StoreSpecs | null): string {
  const screen = row.screens[0];
  if (!screen) return "Size";
  let targetId = screen.storeTargetId;
  if (targetId === undefined) {
    try {
      targetId = leadStoreSizeId(screen.platform, screen.device);
    } catch {
      return "Master";
    }
  }
  const label = specs?.[screen.platform]?.[screen.device]?.find((target) => target.id === targetId)?.label
    ?? targetId;
  return compactStoreSizeLabel(label, screen.device);
}

function EditingBadge() {
  return (
    <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[9px] tracking-normal text-blue-700">
      Editing
    </span>
  );
}

function SizeRowHeader({ label, editing }: { label: string; editing: boolean }) {
  return (
    <header className="mb-3 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      <span>{label}</span>
      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[8px] tracking-normal text-slate-600">
        Variant
      </span>
      {editing ? <EditingBadge /> : null}
      <span className="h-px min-w-12 flex-1 bg-slate-200" aria-hidden="true" />
    </header>
  );
}

export function CanvasViewport({
  images,
  specs,
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
  specs: StoreSpecs | null;
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
  const layout = useStore(editorStore, selectEditorLayout);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastFitLayoutRef = useRef<string | null>(null);
  const previousCanvasStateRef = useRef<CanvasTransitionState>({
    layoutId: layout?.id ?? null,
    layoutMode: layout?.mode ?? null,
    view,
  });
  const initialRevealStartedRef = useRef(false);
  const initialRevealRef = useRef<Animation | null>(null);
  const initialRevealFrameRef = useRef<number | null>(null);
  const transitionRef = useRef<Animation | null>(null);
  const transitionFrameRef = useRef<number | null>(null);
  const zoomRef = useRef(zoom);
  const [fittedView, setFittedView] = useState<WorkspaceView>(view);
  const [initialReveal, setInitialReveal] = useState<"pending" | "running" | "idle">("pending");
  const [transitioning, setTransitioning] = useState(false);

  const activeScreen = layout?.screens.find((screen) => screen.id === activeScreenId) ?? layout?.screens[0];
  const editingScreens = useMemo(() => {
    if (!layout || !activeScreen) return [];
    return workspaceEditingScope(layout, activeScreen);
  }, [activeScreen, layout]);
  const outputRows = useMemo(() => {
    if (!layout || !activeScreen || view !== "overview") return [];
    return workspaceOverviewRows(layout, activeScreen);
  }, [activeScreen, layout, view]);
  const isolatedOutputFamilies = useMemo(
    () => groupIsolatedOverviewRows(outputRows),
    [outputRows],
  );
  const screens = view === "focus" && activeScreen ? [activeScreen] : editingScreens;
  const { fitLayoutKey, fit } = useCanvasViewportMetrics({
    viewportRef,
    zoomRef,
    screens,
    outputRows,
    view,
    connected: layout?.mode === "connected",
    leftInset,
    rightInset,
    onZoomChange,
  });
  const { spacePressed, panning, zoomAt, pointerHandlers } = useCanvasPanZoom({
    viewportRef,
    zoomRef,
    zoom,
    tool,
    leftInset,
    rightInset,
    onZoomChange,
  });

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
    const nextState: CanvasTransitionState = {
      layoutId: layout?.id ?? null,
      layoutMode: layout?.mode ?? null,
      view,
    };
    const transitionKind = canvasTransitionKind(previousCanvasStateRef.current, nextState);
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
      }).catch(() => undefined);
    });
  }, [activeScreenId, fit, layout?.id, layout?.mode, view]);

  useEffect(() => () => {
    initialRevealRef.current?.cancel();
    transitionRef.current?.cancel();
    if (initialRevealFrameRef.current !== null) cancelAnimationFrame(initialRevealFrameRef.current);
    if (transitionFrameRef.current !== null) cancelAnimationFrame(transitionFrameRef.current);
  }, []);

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

  if (!project || !layout || screens.length === 0) {
    return <section className="min-w-0 flex-1 bg-slate-50" />;
  }

  const renderIsolatedScreen = (screen: Screen) => {
    const active = screen.id === activeScreenId;
    const previewWidth = screen.artboard.width * zoom;
    return (
      <div
        key={screen.id}
        data-testid="artboard-preview-item"
        data-artboard-screen-id={screen.id}
        className="min-w-0 shrink-0"
        style={{ width: previewWidth }}
      >
        <ScreenPreviewTitle screen={screen} active={active} />
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
            interactive={layout.mode === "connected" ? false : active}
          />
        </div>
        <ScreenPreviewMetadata screen={screen} />
      </div>
    );
  };

  return (
    <section className="relative min-w-0 flex-1 overflow-hidden bg-slate-50" aria-label="Canvas workspace">
      <CanvasSurface
        viewportRef={viewportRef}
        pattern={pattern}
        pointerHandlers={pointerHandlers}
        view={view}
        fittedView={fittedView}
        initialReveal={initialReveal}
        transitioning={transitioning}
        panning={panning}
        canPan={tool === "hand" || spacePressed}
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
              view === "focus" ? "flex items-start" : "flex flex-col items-start",
            )}
            data-testid={view === "overview" ? "overview-artboards" : "focus-artboard"}
          >
            {view === "overview" ? (
              <div className="flex flex-col gap-14" data-testid="overview-output-families">
                {layout.mode === "connected" ? outputRows.map((row) => (
                  <ConnectedOutputRow
                    key={row.key}
                    row={row}
                    activeScreenId={activeScreenId}
                    images={images}
                    zoom={zoom}
                    onActivate={(screenId) => editorStore.getState().selectScreen(screenId)}
                  />
                )) : isolatedOutputFamilies.map((family) => {
                  const masterRow = family.rows.find((row) => row.screens[0]?.storeTargetId === undefined);
                  const variantRows = family.rows.filter((row) => row !== masterRow);
                  return (
                    <OutputFamilySection
                      key={family.key}
                      label={family.label}
                      editing={family.editing}
                      headerMeta={masterRow ? (
                        <>
                          <span className="shrink-0 text-[9px] tracking-normal text-slate-600">
                            {outputSizeLabel(masterRow, specs)}
                          </span>
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[8px] tracking-normal text-slate-600">
                            Master
                          </span>
                          {masterRow.editing ? <EditingBadge /> : null}
                        </>
                      ) : undefined}
                      showEditingBadge={false}
                      testId="overview-output-family"
                      ariaLabel={`${family.label} output`}
                    >
                      <div className="flex flex-col gap-10">
                        {masterRow ? (
                          <section
                            data-testid="overview-size-row"
                            data-size-kind="master"
                            data-editing={masterRow.editing ? "true" : "false"}
                          >
                            <div className="flex items-start gap-12">
                              {masterRow.screens.map(renderIsolatedScreen)}
                            </div>
                          </section>
                        ) : null}
                        {variantRows.map((row) => (
                          <section
                            key={row.key}
                            data-testid="overview-size-row"
                            data-size-kind="variant"
                            data-editing={row.editing ? "true" : "false"}
                          >
                            <SizeRowHeader
                              label={`${family.label} · ${outputSizeLabel(row, specs)}`}
                              editing={row.editing}
                            />
                            <div className="flex items-start gap-12">
                              {row.screens.map(renderIsolatedScreen)}
                            </div>
                          </section>
                        ))}
                      </div>
                    </OutputFamilySection>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-start gap-0">
                {screens.map(renderIsolatedScreen)}
              </div>
            )}
          </div>
        </div>
      </CanvasSurface>

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
