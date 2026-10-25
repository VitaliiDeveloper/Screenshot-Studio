// SPDX-License-Identifier: Apache-2.0
"use client";

import { useMemo, useRef } from "react";
import { Plus } from "lucide-react";
import { useStore } from "zustand";
import type { ImageCache } from "@screenshot-studio/core/assets";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import type { Screen } from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import {
  CANVAS_PADDING,
  workspaceEditingScope,
  workspaceOverviewRows,
  type CanvasPattern,
  type WorkspaceTool,
  type WorkspaceView,
} from "@web/lib/editor/editor-workspace";
import { editorStore, selectEditorLayout } from "@web/lib/editor/editor-store";
import { cx, editorUi } from "@web/components/editor-ui";
import { CanvasPatternSelect } from "./CanvasPatternSelect";
import { CanvasSurface } from "./CanvasSurface";
import { CanvasZoomControls } from "./CanvasZoomControls";
import { ConnectedOutputRow } from "./ConnectedOutputRow";
import { IsolatedOutputFamilies } from "./IsolatedOutputFamilies";
import { IsolatedScreenPreview } from "./IsolatedScreenPreview";
import { useActiveArtboardScroll } from "./use-active-artboard-scroll";
import { useCanvasPanZoom } from "./use-canvas-pan-zoom";
import { useCanvasTransitions } from "./use-canvas-transitions";
import { useCanvasViewportMetrics } from "./use-canvas-viewport-metrics";

const NO_SCREENS: readonly Screen[] = [];

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
  issues,
  onOpenAdd,
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
  issues?: readonly ProjectIssue[];
  /** Opens the Add panel, the same entry as the Layers subheader’s add button. */
  onOpenAdd?: () => void;
}) {
  const project = useStore(editorStore, (state) => state.project);
  const layout = useStore(editorStore, selectEditorLayout);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);

  const activeScreen = layout?.screens.find((screen) => screen.id === activeScreenId) ?? layout?.screens[0];
  const editingScreens = useMemo(() => {
    if (!layout || !activeScreen) return [];
    return workspaceEditingScope(layout, activeScreen);
  }, [activeScreen, layout]);
  const outputRows = useMemo(() => {
    if (!layout || !activeScreen || view !== "overview") return [];
    return specs
      ? workspaceOverviewRows(layout, activeScreen, specs)
      : workspaceOverviewRows(layout, activeScreen);
  }, [activeScreen, layout, specs, view]);
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
  const { fittedView, initialReveal, transitioning, outgoingScreenId } = useCanvasTransitions({
    contentRef,
    layoutId: layout?.id ?? null,
    layoutMode: layout?.mode ?? null,
    view,
    activeScreenId,
    screens: layout?.screens ?? NO_SCREENS,
    fit,
    fitLayoutKey,
  });
  useActiveArtboardScroll({ viewportRef, activeScreenId, view, leftInset, rightInset });
  const outgoingScreen = view === "focus" && outgoingScreenId !== activeScreen?.id
    ? layout?.screens.find((screen) => screen.id === outgoingScreenId)
    : undefined;

  if (!project || !layout || screens.length === 0) {
    return <section className="min-w-0 flex-1 bg-[var(--editor-color-canvas)]" />;
  }

  const renderIsolatedScreen = (screen: Screen) => (
    <IsolatedScreenPreview
      key={screen.id}
      screen={screen}
      active={screen.id === activeScreenId}
      outgoing={screen.id === outgoingScreen?.id}
      connected={layout.mode === "connected"}
      view={view}
      images={images}
      zoom={zoom}
      issues={issues}
      specs={specs ?? undefined}
    />
  );

  return (
    <section className="relative min-w-0 flex-1 overflow-hidden bg-[var(--editor-color-canvas)]" aria-label="Canvas workspace">
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
        onBlankClick={tool === "select" ? () => editorStore.getState().setSelection([]) : undefined}
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
                    issues={issues}
                    specs={specs ?? undefined}
                    onActivate={(screenId) => editorStore.getState().selectScreen(screenId)}
                  />
                )) : (
                  <IsolatedOutputFamilies
                    rows={outputRows}
                    specs={specs}
                    zoom={zoom}
                    renderScreen={renderIsolatedScreen}
                  />
                )}
              </div>
            ) : (
              <div className="grid items-start [&>*]:[grid-area:1/1]">
                {(outgoingScreen ? [outgoingScreen, ...screens] : screens).map(renderIsolatedScreen)}
              </div>
            )}
          </div>
        </div>
      </CanvasSurface>

      {!controlsHidden && onOpenAdd ? (
        <button
          type="button"
          className={cx(editorUi.buttonSecondary, "absolute top-3 z-30 shadow-lg shadow-slate-950/10")}
          style={{ left: leftInset + 12 }}
          onClick={onOpenAdd}
        >
          <Plus size={14} strokeWidth={2} aria-hidden="true" /> Add
        </button>
      ) : null}

      {!controlsHidden ? (
        <div
          data-testid="canvas-footer"
          className="absolute bottom-4 z-20 flex -translate-x-1/2 items-center rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-1 shadow-lg shadow-slate-950/10"
          style={{ left: `calc(50% + ${(leftInset - rightInset) / 2}px)` }}
        >
          <CanvasZoomControls zoom={zoom} onZoom={zoomAt} onFit={fit} />
          <span className="mx-1 h-5 w-px bg-[var(--editor-color-border)]" aria-hidden="true" />
          <CanvasPatternSelect pattern={pattern} onPatternChange={onPatternChange} />
        </div>
      ) : null}
    </section>
  );
}
