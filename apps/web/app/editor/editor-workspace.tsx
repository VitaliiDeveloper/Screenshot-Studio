// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useStore } from "zustand";
import {
  adjacentSizeScreenId,
  type CanvasPattern,
  type MediaAssetTarget,
  type ResourceDialog,
  type WorkspacePanel,
  type WorkspaceTool,
  type WorkspaceView,
} from "@web/lib/editor/editor-workspace";
import { editorStore, selectEditorLayout } from "@web/lib/editor/editor-store";
import { countIssues, missingImageTarget } from "@web/lib/editor/editor-issues";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { LeftPanel } from "@web/components/LeftPanel";
import { Inspector } from "@web/components/inspector/Inspector";
import { Toolbar } from "@web/components/toolbar/Toolbar";
import { ToolRail } from "@web/components/ToolRail";
import { CaptureImportDialog } from "@web/components/project-launcher/CaptureImportDialog";
import { ConfirmationDialog } from "@web/components/editor-ui";
import { IssuesDialog } from "@web/components/IssuesDialog";
import { EditorSidePanel } from "@web/components/editor-shell/EditorSidePanel";
import { StatusBar } from "@web/components/editor-shell/StatusBar";
import { playEntries } from "@web/components/play-gallery-model";
import {
  readWorkspaceNavigationState,
  writeWorkspaceNavigationState,
} from "@web/lib/editor/editor-workspace-navigation";
import { EditorResourceDialogs } from "./editor-resource-dialogs";
import { useEditorEscapeRouting, useEditorKeyboardRouting } from "./editor-keyboard";
import { useEditorCaptureImport } from "./use-editor-capture-import";
import { useEditorProjectNavigation } from "./use-editor-project-navigation";
import { useEditorResources } from "./editor-resources";
import { useEditorSaveGuards } from "./use-editor-save-guards";
import { useEditorIssues } from "./use-editor-issues";

// react-konva needs the DOM; load the complete viewport client-only (no SSR).
const DynamicCanvasViewport = dynamic(
  () => import("@web/components/canvas-viewport/CanvasViewport").then((m) => m.CanvasViewport),
  { ssr: false },
);

// EditorStage pulls in react-konva, which needs the DOM.
const DynamicPlayGalleryDialog = dynamic(
  () => import("@web/components/PlayGalleryDialog").then((m) => m.PlayGalleryDialog),
  { ssr: false },
);

const SIDE_PANEL_WIDTH = 288;

export function EditorWorkspace({ expectedProjectId }: { expectedProjectId: string }) {
  const router = useRouter();
  const pathname = usePathname();
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
    reload: reloadResources,
    cacheImage,
  } = useEditorResources(expectedProjectId);
  const [zoom, setZoom] = useState(0.5);
  const [view, setView] = useState<WorkspaceView>("overview");
  const [tool, setTool] = useState<WorkspaceTool>("select");
  const [pattern, setPattern] = useState<CanvasPattern>("dots");
  const [panel, setPanelState] = useState<WorkspacePanel | null>("structure");
  const [lastPanel, setLastPanel] = useState<WorkspacePanel>("structure");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [dialog, setDialog] = useState<ResourceDialog | null>(null);
  const [deviceFrameAssetTarget, setDeviceFrameAssetTarget] = useState<{
    elementId: string;
    screenId: string;
  } | null>(null);
  const [mediaAssetTarget, setMediaAssetTarget] = useState<MediaAssetTarget | null>(null);
  const [localeDialogOpen, setLocaleDialogOpen] = useState(false);
  const [layout, setLayout] = useState({ overlay: false, compact: false, phone: false });
  const [workspaceRestoredFor, setWorkspaceRestoredFor] = useState<string | null>(null);
  const [exportRequestKey, setExportRequestKey] = useState(0);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [playOpen, setPlayOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const saveStatus = useStore(editorStore, (state) => state.saveStatus);
  const saveError = useStore(editorStore, (state) => state.saveError);
  const project = useStore(editorStore, (state) => state.project);
  const captureImport = useEditorCaptureImport(project, activeProjectId, reloadResources, specs);
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
    if (next !== "structure") setSearchOpen(false);
  }, []);
  const projectNavigation = useEditorProjectNavigation(activeProjectId, workspaceNavigationState);
  useEditorSaveGuards(saveStatus);
  // Fallback-font metrics would report false overflow, so measure only with every project font loaded.
  const textMeasured = Boolean(images && specs) && fontWarnings.length === 0 && !fontRetrying;
  const issues = useEditorIssues(textMeasured, images);
  const issueCounts = useMemo(() => countIssues(issues), [issues]);
  const canPlay = useStore(editorStore, (state) =>
    specs ? playEntries(state.project, state.activeLayoutId, state.activeScreenId, specs).length > 0 : false);
  const goToIssue = useCallback((issue: ProjectIssue) => {
    const store = editorStore.getState();
    if (issue.kind === "missing-locale-screen") {
      store.selectScreen(issue.sourceScreenId);
    } else {
      store.selectScreen(issue.screenId);
      if (issue.elementId) store.select(issue.elementId, issue.screenId);
    }
    setView("focus");
    setIssuesOpen(false);
  }, []);
  const replaceMissingImage = useCallback((issue: Extract<ProjectIssue, { kind: "missing-image" }>) => {
    const current = editorStore.getState().project;
    const element = current ? missingImageTarget(current, issue)?.element : undefined;
    // Go to first: the background picker writes to the active screen.
    goToIssue(issue);
    if (element === undefined) return;
    if (element === null) {
      setDialog("background-assets");
    } else if (element.type === "device-frame") {
      setDeviceFrameAssetTarget({ elementId: element.id, screenId: issue.screenId });
      setDialog("mockup-screenshot-assets");
    } else {
      setMediaAssetTarget({ elementId: element.id, screenId: issue.screenId, elementType: element.type });
      setDialog("replace-media-asset");
    }
  }, [goToIssue]);

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
      if (intent) router.replace(pathname, { scroll: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeProjectId, pathname, router, setPanel, workspaceRestoredFor]);

  const openDialog = useCallback((next: ResourceDialog) => setDialog(next), []);
  const closeInspector = useCallback(() => setInspectorOpen(false), []);
  const keyboardHandlers = useMemo(() => ({
    onOpenDialog: openDialog,
    onSearch: () => {
      if (layout.compact) setInspectorOpen(false);
      setPanel("structure");
      setSearchOpen(true);
    },
    onExport: () => setExportRequestKey((current) => current + 1),
    onToggleView: () => setView((current) => (current === "focus" ? "overview" : "focus")),
    onStepSize: (step: -1 | 1) => {
      const state = editorStore.getState();
      const activeLayout = selectEditorLayout(state);
      const activeScreen = activeLayout?.screens.find((screen) => screen.id === state.activeScreenId);
      if (!specs || !activeLayout || !activeScreen) return;
      const next = adjacentSizeScreenId(activeLayout, activeScreen, step, specs);
      if (next) state.selectScreen(next);
    },
  }), [layout.compact, openDialog, setPanel, specs]);
  useEditorKeyboardRouting(keyboardHandlers);
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
  if (!images || !specs) {
    return <main className="grid h-dvh place-items-center bg-slate-50 text-sm text-slate-500">Loading workspace…</main>;
  }
  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden bg-white">
      <Toolbar
        view={view}
        specs={specs}
        inspectorOpen={inspectorOpen}
        exportRequestKey={exportRequestKey}
        onViewChange={setView}
        onToggleInspector={() => {
          const opening = !inspectorOpen;
          if (opening && layout.compact) setPanel(null);
          setInspectorOpen(opening);
        }}
        onOpenProjects={projectNavigation.openProjects}
        projectsBusy={projectNavigation.busy}
        issueCounts={issueCounts}
        issues={issues}
        onOpenIssues={() => setIssuesOpen(true)}
      />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <ToolRail
          tool={tool}
          panel={panel}
        onOpenProjects={projectNavigation.openProjects}
        projectsBusy={projectNavigation.busy}
          onToolChange={setTool}
          onPanelToggle={(next) => {
            const opening = panel !== next;
            if (opening && layout.compact) setInspectorOpen(false);
            setPanel(opening ? next : null);
          }}
          onOpenDialog={setDialog}
          onOpenLocales={() => setLocaleDialogOpen(true)}
          onOpenPlay={() => setPlayOpen(true)}
          playDisabled={!canPlay}
        />
        <EditorSidePanel side="left" open={panel !== null}>
          <LeftPanel
            panel={panel ?? lastPanel}
            images={images}
            view={view}
            specs={specs}
            issues={issues}
            onClose={() => setPanel(panel === "add" ? "structure" : null)}
            onOpenAdd={() => setPanel("add")}
            onOpenDialog={setDialog}
            onImportCaptures={captureImport.open}
            searchOpen={searchOpen}
            onSearchOpenChange={setSearchOpen}
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
            issues={issues}
            onOpenAdd={() => {
              if (layout.compact) setInspectorOpen(false);
              setPanel("add");
            }}
          />
        </div>
        <EditorSidePanel side="right" open={inspectorOpen}>
          <Inspector
            specs={specs}
            issues={issues}
            textMeasured={textMeasured}
            onOpenBackgroundAsset={() => setDialog("background-assets")}
            onOpenDeviceFrameAsset={(target) => {
              setDeviceFrameAssetTarget(target);
              setDialog("mockup-screenshot-assets");
            }}
            onOpenMediaAsset={(target) => {
              setMediaAssetTarget(target);
              setDialog("replace-media-asset");
            }}
            onClose={() => setInspectorOpen(false)}
            className="!w-full"
          />
        </EditorSidePanel>
      </div>
      <StatusBar />
      {saveStatus === "error" && saveError && !projectNavigation.error ? (
        <div role="alert" className="absolute right-3 top-16 z-40 max-w-sm rounded-xl border border-red-200 bg-white px-3 py-2 text-xs text-red-700 shadow-lg">
          Save failed: {saveError}
        </div>
      ) : null}
      {projectNavigation.error ? (
        <ConfirmationDialog
          title="Project could not be saved"
          description="The project file may have been moved or deleted. Stay in the editor to retry, or close this project without saving."
          confirmLabel={projectNavigation.abandoning ? "Closing…" : "Close without saving"}
          cancelLabel="Stay in editor"
          busy={projectNavigation.abandoning}
          onClose={projectNavigation.clearError}
          onConfirm={projectNavigation.closeWithoutSaving}
        />
      ) : null}
      {fontWarnings.length > 0 ? (
        <div role="alert" className="absolute bottom-12 left-16 z-40 max-w-xl rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg">
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
      {playOpen ? (
        <DynamicPlayGalleryDialog images={images} specs={specs} onClose={() => setPlayOpen(false)} />
      ) : null}
      {issuesOpen ? (
        <IssuesDialog
          issues={issues}
          specs={specs}
          onGoTo={goToIssue}
          onReplaceImage={replaceMissingImage}
          onClose={() => setIssuesOpen(false)}
        />
      ) : null}
      <EditorResourceDialogs
        dialog={dialog}
        specs={specs}
        localeDialogOpen={localeDialogOpen}
        deviceFrameAssetTarget={deviceFrameAssetTarget}
        mediaAssetTarget={mediaAssetTarget}
        cacheImage={cacheImage}
        closeDialog={() => setDialog(null)}
        closeLocaleDialog={() => setLocaleDialogOpen(false)}
        clearDeviceFrameAssetTarget={() => setDeviceFrameAssetTarget(null)}
        clearMediaAssetTarget={() => setMediaAssetTarget(null)}
      />
      {captureImport.state.status === "closed" ? null : (
        <CaptureImportDialog
          state={captureImport.state}
          specs={specs}
          onClose={captureImport.close}
          onSelectFiles={captureImport.selectFiles}
          onChooseDestination={captureImport.chooseDestination}
          onChooseCurrentLayout={captureImport.chooseCurrentLayout}
          onChangeNewProject={captureImport.changeNewProject}
          onPreview={captureImport.preview}
          onApply={captureImport.apply}
          onCancel={captureImport.cancel}
          onRetry={captureImport.retry}
          onRecoverStale={captureImport.recoverStale}
        />
      )}
    </main>
  );
}
