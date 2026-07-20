// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "zustand";
import type {
  CanvasPattern,
  ResourceDialog,
  WorkspacePanel,
  WorkspaceTool,
  WorkspaceView,
} from "../../lib/editor-workspace";
import { editorStore } from "../../lib/editor-store";
import { LeftPanel } from "../../components/LeftPanel";
import { Inspector } from "../../components/Inspector";
import { Toolbar } from "../../components/Toolbar";
import { ToolRail } from "../../components/ToolRail";
import { FontManagerDialog } from "../../components/FontManagerDialog";
import { ThemeManagerDialog } from "../../components/ThemeManagerDialog";
import { TemplateLibraryDialog } from "../../components/TemplateLibraryDialog";
import { LocaleManagerDialog } from "../../components/LocaleManagerDialog";
import { AssetPickerDialog } from "../../components/AssetPickerDialog";
import { EditorSidePanel } from "../../components/editor-shell/EditorSidePanel";
import {
  flushScheduledSave,
  hasPendingProjectSave,
} from "../../lib/debounced-save";
import {
  navigateToProjects,
  readWorkspaceNavigationState,
  writeWorkspaceNavigationState,
} from "../../lib/editor-workspace-navigation";
import { useEditorEscapeRouting, useEditorKeyboardRouting } from "./editor-keyboard";
import { useEditorResources } from "./editor-resources";

// react-konva needs the DOM; load the complete viewport client-only (no SSR).
const DynamicCanvasViewport = dynamic(
  () => import("../../components/CanvasViewport").then((m) => m.CanvasViewport),
  { ssr: false },
);

const SIDE_PANEL_WIDTH = 288;

export default function EditorPage() {
  const router = useRouter();
  const {
    error,
    images,
    specs,
    fontWarnings,
    retry,
    reloading,
    retryFonts,
    fontRetrying,
    activeProjectId,
  } = useEditorResources();
  const [zoom, setZoom] = useState(0.5);
  const [view, setView] = useState<WorkspaceView>("overview");
  const [tool, setTool] = useState<WorkspaceTool>("select");
  const [pattern, setPattern] = useState<CanvasPattern>("dots");
  const [panel, setPanelState] = useState<WorkspacePanel | null>("structure");
  const [lastPanel, setLastPanel] = useState<WorkspacePanel>("structure");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [dialog, setDialog] = useState<ResourceDialog | null>(null);
  const [localeDialogOpen, setLocaleDialogOpen] = useState(false);
  const [layout, setLayout] = useState({ overlay: false, compact: false, phone: false });
  const [workspaceRestoredFor, setWorkspaceRestoredFor] = useState<string | null>(null);
  const [navigationBusy, setNavigationBusy] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [exportRequestKey, setExportRequestKey] = useState(0);
  const saveStatus = useStore(editorStore, (state) => state.saveStatus);
  const saveError = useStore(editorStore, (state) => state.saveError);
  const workspaceNavigationState = useMemo(() => ({
    zoom,
    view,
    tool,
    pattern,
    panel,
    lastPanel,
    inspectorOpen,
  }), [zoom, view, tool, pattern, panel, lastPanel, inspectorOpen]);
  const setPanel = useCallback((next: WorkspacePanel | null) => {
    setPanelState(next);
    if (next) setLastPanel(next);
  }, []);

  useEffect(() => {
    const overlayQuery = window.matchMedia("(max-width: 1279px)");
    const compactQuery = window.matchMedia("(max-width: 959px)");
    const phoneQuery = window.matchMedia("(max-width: 639px)");
    const sync = () => {
      setLayout({
        overlay: overlayQuery.matches,
        compact: compactQuery.matches,
        phone: phoneQuery.matches,
      });
      if (compactQuery.matches) {
        setPanel(null);
        setInspectorOpen(false);
      }
    };
    sync();
    overlayQuery.addEventListener("change", sync);
    compactQuery.addEventListener("change", sync);
    phoneQuery.addEventListener("change", sync);
    return () => {
      overlayQuery.removeEventListener("change", sync);
      compactQuery.removeEventListener("change", sync);
      phoneQuery.removeEventListener("change", sync);
    };
  }, [setPanel]);

  useEffect(() => {
    if (!activeProjectId) return;
    const frame = requestAnimationFrame(() => {
      const restored = readWorkspaceNavigationState(activeProjectId);
      if (restored) {
        setZoom(restored.zoom);
        setView(restored.view);
        setTool(restored.tool);
        setPattern(restored.pattern);
        setPanel(restored.panel);
        setLastPanel(restored.lastPanel);
        setInspectorOpen(window.matchMedia("(max-width: 959px)").matches
          ? false
          : restored.inspectorOpen);
      }
      setWorkspaceRestoredFor(activeProjectId);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeProjectId, setPanel]);

  useEffect(() => {
    if (!activeProjectId || workspaceRestoredFor !== activeProjectId) return;
    const timer = setTimeout(() => {
      writeWorkspaceNavigationState(activeProjectId, workspaceNavigationState);
    }, 120);
    return () => clearTimeout(timer);
  }, [activeProjectId, workspaceNavigationState, workspaceRestoredFor]);

  useEffect(() => {
    if (!activeProjectId || workspaceRestoredFor !== activeProjectId) return;
    const frame = requestAnimationFrame(() => {
      const intent = new URLSearchParams(window.location.search).get("intent");
      if (intent === "locales") setLocaleDialogOpen(true);
      if (intent === "export") setExportRequestKey((current) => current + 1);
      if (intent === "add-screen" || intent === "layouts") setPanel("structure");
      if (intent) router.replace("/editor", { scroll: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeProjectId, router, setPanel, workspaceRestoredFor]);

  useEffect(() => {
    const onPageHide = () => { void flushScheduledSave().catch(() => undefined); };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingProjectSave() && saveStatus !== "saving" && saveStatus !== "error") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveStatus]);

  const openProjects = useCallback(() => {
    if (navigationBusy) return;
    if (activeProjectId) {
      writeWorkspaceNavigationState(activeProjectId, workspaceNavigationState);
    }
    setNavigationBusy(true);
    setNavigationError(null);
    void navigateToProjects({ navigate: () => router.push("/") })
      .catch((caught: unknown) => {
        setNavigationError(caught instanceof Error ? caught.message : String(caught));
        setNavigationBusy(false);
      });
  }, [activeProjectId, navigationBusy, router, workspaceNavigationState]);

  const openDialog = useCallback((next: ResourceDialog) => setDialog(next), []);
  const closeInspector = useCallback(() => setInspectorOpen(false), []);
  useEditorKeyboardRouting(openDialog);
  useEditorEscapeRouting({
    dialog,
    localeDialogOpen,
    panel,
    overlay: layout.overlay,
    inspectorOpen,
    setPanel,
    closeInspector,
  });

  if (error) {
    return (
      <main className="grid h-dvh place-items-center bg-slate-50 p-6">
        <div role="alert" className="max-w-lg rounded-xl border border-red-200 bg-white p-5 text-sm text-red-700 shadow-sm">
          <p className="whitespace-pre-wrap">{error}</p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
            disabled={reloading}
            onClick={retry}
          >
            {reloading ? "Retrying workspace resources…" : "Retry workspace resources"}
          </button>
          <Link
            href="/"
            className="ml-3 inline-flex rounded-lg px-3 py-2 text-xs font-semibold text-red-700 underline hover:bg-red-50"
          >
            Return to project launcher
          </Link>
        </div>
      </main>
    );
  }
  if (!images) return <main className="grid h-dvh place-items-center bg-slate-50 text-sm text-slate-500">Loading workspace…</main>;
  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden bg-white">
      <Toolbar
        view={view}
        inspectorOpen={inspectorOpen}
        exportRequestKey={exportRequestKey}
        onViewChange={setView}
        onOpenLocales={() => setLocaleDialogOpen(true)}
        onToggleInspector={() => {
          const opening = !inspectorOpen;
          if (opening && layout.compact) setPanel(null);
          setInspectorOpen(opening);
        }}
      />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <ToolRail
          tool={tool}
          panel={panel}
          onOpenProjects={openProjects}
          projectsBusy={navigationBusy}
          onToolChange={setTool}
          onPanelToggle={(next) => {
            const opening = panel !== next;
            if (opening && layout.compact) setInspectorOpen(false);
            setPanel(opening ? next : null);
          }}
        />
        <EditorSidePanel side="left" open={panel !== null}>
          <LeftPanel
            panel={panel ?? lastPanel}
            images={images}
            onClose={() => setPanel(panel === "add" ? "structure" : null)}
            onOpenAdd={() => setPanel("add")}
            onOpenDialog={setDialog}
          />
        </EditorSidePanel>
        <div className="flex min-w-0 flex-1">
          <DynamicCanvasViewport
            images={images}
            specs={specs}
            zoom={zoom}
            view={view}
            tool={tool}
            pattern={pattern}
            onZoomChange={setZoom}
            onPatternChange={setPattern}
            leftInset={layout.overlay && panel ? SIDE_PANEL_WIDTH : 0}
            rightInset={layout.overlay && inspectorOpen ? SIDE_PANEL_WIDTH : 0}
            controlsHidden={layout.phone && Boolean(panel || inspectorOpen)}
          />
        </div>
        <EditorSidePanel side="right" open={inspectorOpen}>
          <Inspector
            specs={specs}
            onOpenBackgroundAsset={() => setDialog("background-assets")}
            onClose={() => setInspectorOpen(false)}
            className="!w-full"
          />
        </EditorSidePanel>
      </div>
      {saveStatus === "error" && saveError ? (
        <div role="alert" className="absolute right-3 top-16 z-40 max-w-sm rounded-xl border border-red-200 bg-white px-3 py-2 text-xs text-red-700 shadow-lg">
          Save failed: {saveError}
        </div>
      ) : null}
      {navigationError ? (
        <div role="alert" className="absolute left-1/2 top-16 z-40 max-w-sm -translate-x-1/2 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs text-red-700 shadow-lg">
          Projects could not be opened because the latest project changes could not be saved: {navigationError}
        </div>
      ) : null}
      {fontWarnings.length > 0 ? (
        <div role="alert" className="absolute bottom-3 left-16 z-40 max-w-xl rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg">
          <p className="font-semibold">Some project fonts could not be loaded.</p>
          <ul className="mt-1 list-disc pl-4">
            {fontWarnings.map(({ font, error: fontError }) => (
              <li key={`${font.family}-${font.weight}-${font.path}`}>
                {font.family} {font.weight} ({font.path}): {fontError.message}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            Preview may use a fallback. Export remains blocked until every project font resolves.
          </p>
          <button
            type="button"
            className="mt-2 rounded-md border border-amber-400 bg-white px-2 py-1 font-semibold hover:bg-amber-100"
            disabled={fontRetrying}
            onClick={retryFonts}
          >
            {fontRetrying ? "Retrying project fonts…" : "Retry project fonts"}
          </button>
        </div>
      ) : null}
      <FontManagerDialog open={dialog === "fonts"} onClose={() => setDialog(null)} />
      {dialog === "themes" ? <ThemeManagerDialog onClose={() => setDialog(null)} /> : null}
      {dialog === "templates" ? <TemplateLibraryDialog onClose={() => setDialog(null)} /> : null}
      {dialog === "screenshot-assets" ? (
        <AssetPickerDialog elementType="screenshot" onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "image-assets" ? (
        <AssetPickerDialog elementType="image" onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "background-assets" ? (
        <AssetPickerDialog elementType="background" onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "store-badge-assets" ? (
        <AssetPickerDialog elementType="store-badge" onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "device-frame-assets" ? (
        <AssetPickerDialog elementType="device-frame" onClose={() => setDialog(null)} />
      ) : null}
      {localeDialogOpen ? <LocaleManagerDialog onClose={() => setLocaleDialogOpen(false)} /> : null}
    </main>
  );
}
