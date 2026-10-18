// SPDX-License-Identifier: Apache-2.0
"use client";

import { useMemo, useRef } from "react";
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
import { cx } from "@web/components/editor-ui";
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
  const { fittedView, initialReveal, transitioning } = useCanvasTransitions({
    contentRef,
    layoutId: layout?.id ?? null,
    layoutMode: layout?.mode ?? null,
    view,
    activeScreenId,
    fit,
    fitLayoutKey,
  });
  useActiveArtboardScroll({ viewportRef, activeScreenId, view, leftInset, rightInset });

  if (!project || !layout || screens.length === 0) {
    return <section className="min-w-0 flex-1 bg-slate-50" />;
  }

  const renderIsolatedScreen = (screen: Screen) => (
    <IsolatedScreenPreview
      key={screen.id}
      screen={screen}
      active={screen.id === activeScreenId}
      connected={layout.mode === "connected"}
      view={view}
      images={images}
      zoom={zoom}
      issues={issues}
    />
  );

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
              <div className="flex items-start gap-0">
                {screens.map(renderIsolatedScreen)}
              </div>
            )}
          </div>
        </div>
      </CanvasSurface>

      {!controlsHidden ? (
        <CanvasPatternSelect pattern={pattern} rightInset={rightInset} onPatternChange={onPatternChange} />
      ) : null}

      {!controlsHidden ? (
        <CanvasZoomControls
          zoom={zoom}
          leftInset={leftInset}
          rightInset={rightInset}
          onZoom={zoomAt}
          onFit={fit}
        />
      ) : null}
    </section>
  );
}
