// SPDX-License-Identifier: Apache-2.0
"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
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
import { flushScheduledSave } from "../../lib/debounced-save";
import { useEditorEscapeRouting, useEditorKeyboardRouting } from "./editor-keyboard";
import { useEditorResources } from "./editor-resources";

// react-konva needs the DOM; load the complete viewport client-only (no SSR).
const DynamicCanvasViewport = dynamic(
  () => import("../../components/CanvasViewport").then((m) => m.CanvasViewport),
  { ssr: false },
);

const SIDE_PANEL_WIDTH = 288;
const NEXT_DEVTOOLS_ALIGNMENT_STYLE_ID = "screenshot-studio-next-devtools-alignment";

export default function EditorPage() {
  const { error, images, specs } = useEditorResources();
  const [zoom, setZoom] = useState(0.5);
  const [view, setView] = useState<WorkspaceView>("overview");
  const [tool, setTool] = useState<WorkspaceTool>("select");
  const [pattern, setPattern] = useState<CanvasPattern>("dots");
  const [panel, setPanel] = useState<WorkspacePanel | null>("structure");
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [dialog, setDialog] = useState<ResourceDialog | null>(null);
  const [localeDialogOpen, setLocaleDialogOpen] = useState(false);
  const [layout, setLayout] = useState({ overlay: false, compact: false, phone: false });
  const saveStatus = useStore(editorStore, (state) => state.saveStatus);
  const saveError = useStore(editorStore, (state) => state.saveError);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    let injectedStyle: HTMLStyleElement | null = null;
    const alignIndicator = () => {
      if (injectedStyle?.isConnected) return;
      const root = document.querySelector("nextjs-portal")?.shadowRoot;
      if (!root) return;

      const existing = root.querySelector<HTMLStyleElement>(`#${NEXT_DEVTOOLS_ALIGNMENT_STYLE_ID}`);
      if (existing) {
        injectedStyle = existing;
        return;
      }

      const style = document.createElement("style");
      style.id = NEXT_DEVTOOLS_ALIGNMENT_STYLE_ID;
      // Next renders a 36px dev indicator in a ShadowRoot. Center it in the 56px editor tool rail.
      style.textContent = "#devtools-indicator { left: 10px !important; }";
      root.append(style);
      injectedStyle = style;
    };

    alignIndicator();
    const observer = new MutationObserver(alignIndicator);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      injectedStyle?.remove();
    };
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
  }, []);

  useEffect(() => {
    const onPageHide = () => { void flushScheduledSave().catch(() => undefined); };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

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

  if (error) return <main className="grid h-dvh place-items-center whitespace-pre-wrap p-6 text-sm text-red-600">{error}</main>;
  if (!images) return <main className="grid h-dvh place-items-center bg-slate-50 text-sm text-slate-500">Loading workspace…</main>;
  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden bg-white">
      <Toolbar
        view={view}
        inspectorOpen={inspectorOpen}
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
          onToolChange={setTool}
          onPanelToggle={(next) => {
            const opening = panel !== next;
            if (opening && layout.compact) setInspectorOpen(false);
            setPanel(opening ? next : null);
          }}
        />
        {panel ? (
          <LeftPanel
            panel={panel}
            images={images}
            onClose={() => setPanel(panel === "add" ? "structure" : null)}
            onOpenAdd={() => setPanel("add")}
            onOpenDialog={setDialog}
          />
        ) : null}
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
        {inspectorOpen ? (
          <div className="absolute inset-y-0 right-0 z-30 shrink-0 xl:static">
            <Inspector
              specs={specs}
              onOpenBackgroundAsset={() => setDialog("background-assets")}
              onClose={() => setInspectorOpen(false)}
            />
          </div>
        ) : null}
      </div>
      {saveStatus === "error" && saveError ? (
        <div role="alert" className="absolute right-3 top-16 z-40 max-w-sm rounded-xl border border-red-200 bg-white px-3 py-2 text-xs text-red-700 shadow-lg">
          Save failed: {saveError}
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
