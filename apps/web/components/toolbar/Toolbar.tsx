// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  Download,
  LayoutGrid,
  PanelsTopLeft,
  PanelRight,
  Play,
  Redo2,
  Scan,
  Undo2,
} from "lucide-react";
import { layoutLocales } from "@screenshot-studio/core/model";
import { DEFAULT_STORE_SPECS, type StoreSpecs } from "@screenshot-studio/core/export";
import type { WorkspaceView } from "@web/lib/editor/editor-workspace";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import type { IssueCounts } from "@web/lib/editor/editor-issues";
import { editorStore, selectEditorLayout } from "@web/lib/editor/editor-store";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";
import { ExportDialog } from "@web/components/ExportDialog";
import { exportButtonLabel, exportFileCount } from "@web/components/export-dialog-model";
import { cx, editorUi } from "@web/components/editor-ui";
import { LayoutSelector } from "@web/components/LayoutSelector";
import { playEntries } from "@web/components/play-gallery-model";
import { toolbarMeasurementKey } from "./toolbar-density";
import { useToolbarDensity } from "./use-toolbar-density";
import { ToolbarIssuesButton, toolbarIssuesLabel } from "./ToolbarIssuesButton";
import { ToolbarLocaleSelect } from "./ToolbarLocaleSelect";
import { ToolbarOverflowMenu } from "./ToolbarOverflowMenu";

const EMPTY_LOCALES: string[] = [];
const NO_ISSUES: IssueCounts = { blockers: 0, warnings: 0 };
const toolbarMotion = "transition-opacity duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] [&_button]:duration-[var(--editor-motion-fast)] [&_button]:ease-[var(--editor-motion-ease)]";

export function Toolbar({
  view,
  inspectorOpen,
  onViewChange,
  onToggleInspector,
  onOpenProjects,
  projectsBusy = false,
  exportRequestKey = 0,
  specs = DEFAULT_STORE_SPECS,
  issueCounts = NO_ISSUES,
  issues,
  onOpenIssues,
  onOpenPlay,
}: {
  view: WorkspaceView;
  inspectorOpen: boolean;
  onViewChange: (view: WorkspaceView) => void;
  onToggleInspector: () => void;
  onOpenProjects: () => void;
  projectsBusy?: boolean;
  exportRequestKey?: number;
  specs?: StoreSpecs;
  issueCounts?: IssueCounts;
  issues?: readonly ProjectIssue[];
  onOpenIssues?: () => void;
  onOpenPlay?: () => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const projectName = useStore(editorStore, (state) => state.project?.meta.name ?? "Untitled project");
  const activeLayout = useStore(editorStore, selectEditorLayout);
  const locales = activeLayout ? layoutLocales(activeLayout) : EMPTY_LOCALES;
  const activeLocale = useStore(editorStore, (state) =>
    state.project?.layouts.find((layout) => layout.id === state.activeLayoutId)?.screens
      .find((screen) => screen.id === state.activeScreenId)?.locale
      ?? state.project?.layouts.find((layout) => layout.id === state.activeLayoutId)?.screens[0]?.locale
      ?? "",
  );
  const canUndo = useStore(editorStore, (state) => state.historyPast.length > 0);
  const canRedo = useStore(editorStore, (state) => state.historyFuture.length > 0);
  const exportCount = useStore(editorStore, (state) => exportFileCount(state.project, state.activeLayoutId, specs));
  const exportLabel = exportButtonLabel(exportCount);
  const canPlay = useStore(editorStore, (state) =>
    playEntries(state.project, state.activeLayoutId, state.activeScreenId, specs).length > 0);
  const issueTotal = issueCounts.blockers + issueCounts.warnings;
  const localeOptions = useMemo(
    () => locales.map((locale) => ({ value: locale, label: locale })),
    [locales],
  );
  const measurementContentKey = toolbarMeasurementKey([
    projectName,
    activeLayout?.id ?? "",
    activeLayout?.name ?? "",
    activeLayout?.mode ?? "",
    activeLocale,
    exportCount,
    issueTotal,
    ...localeOptions.flatMap((option) => [option.value, option.label]),
  ]);
  const {
    density,
    densityReady,
    overflowOpen,
    setOverflowOpen,
    headerRef,
    leftRef,
    viewSwitchRef,
    rightRef,
    exportRef,
    overflowRef,
    overflowTriggerRef,
  } = useToolbarDensity(measurementContentKey);

  useEffect(() => {
    if (exportRequestKey <= 0) return;
    const frame = requestAnimationFrame(() => setExportOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [exportRequestKey]);

  const compactControls = density !== "full";
  const minimalControls = density === "minimal";
  const secondaryOverflowed = density === "overflow-secondary" || density === "overflow-locale" || minimalControls;
  const localeOverflowed = density === "overflow-locale" || minimalControls;
  const compactSharedButtonClassName = compactControls ? "!gap-0" : undefined;
  const toolbarLabelClassName = cx(
    "inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-out",
    compactControls ? "max-w-0 opacity-0" : "max-w-24 opacity-100",
  );

  return (
    <header
      ref={headerRef}
      data-density={density}
      data-density-ready={densityReady}
      className={cx(
        "relative grid min-h-13 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-5 border-b border-slate-200 bg-white px-3 shadow-[0_1px_0_rgba(15,23,42,0.02)] sm:px-4",
        !densityReady && "invisible",
      )}
    >
      <div className="flex w-full min-w-0 items-center justify-self-start">
        <div ref={leftRef} data-toolbar-left-content className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            aria-label="Screenshot Studio, back to Projects"
            title="Back to Projects"
            disabled={projectsBusy}
            className="hidden shrink-0 items-center gap-2.5 rounded-lg text-slate-950 transition-colors hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 disabled:cursor-wait disabled:opacity-60 sm:inline-flex"
            onClick={onOpenProjects}
          >
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm shadow-blue-600/20">
              <PanelsTopLeft size={16} strokeWidth={1.9} />
            </span>
            <span
              data-toolbar-label
              className={cx(
                "hidden overflow-hidden whitespace-nowrap text-sm font-semibold tracking-tight transition-[max-width,opacity] duration-200 ease-out md:inline-block",
                compactControls ? "md:max-w-0 md:opacity-0" : "md:max-w-40 md:opacity-100",
              )}
            >Screenshot Studio</span>
          </button>
          <span className="hidden text-xs text-slate-300 xl:inline" aria-hidden="true">/</span>
          <span className="hidden max-w-48 truncate whitespace-nowrap text-xs font-medium text-slate-600 xl:inline">{projectName}</span>
          <span className="hidden text-xs text-slate-300 xl:inline" aria-hidden="true">/</span>
          <LayoutSelector />
        </div>
      </div>

      <div ref={viewSwitchRef} className="flex items-center gap-1 justify-self-center">
        <div
          className={cx(
            "flex items-center rounded-xl border border-slate-200 bg-slate-50",
            minimalControls ? "p-0.5" : "p-1",
          )}
          aria-label="Canvas view"
        >
          <button
            type="button"
            aria-label="Focus"
            aria-pressed={view === "focus"}
            title="Focus"
            className={cx(
              "inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 lg:px-3",
              compactControls ? "gap-0" : "gap-1.5",
              view === "focus" ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800",
            )}
            onClick={() => onViewChange("focus")}
          >
            <Scan size={14} strokeWidth={1.9} /> <span data-toolbar-label className={toolbarLabelClassName}>Focus</span>
          </button>
          <button
            type="button"
            aria-label="Overview"
            aria-pressed={view === "overview"}
            title="Overview"
            className={cx(
              "inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 lg:px-3",
              compactControls ? "gap-0" : "gap-1.5",
              view === "overview" ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-800",
            )}
            onClick={() => onViewChange("overview")}
          >
            <LayoutGrid size={14} strokeWidth={1.9} /> <span data-toolbar-label className={toolbarLabelClassName}>Overview</span>
          </button>
        </div>
        {onOpenPlay ? (
          <button
            type="button"
            aria-label="Play"
            title="Play"
            disabled={!canPlay}
            className={cx(editorUi.buttonGhost, compactSharedButtonClassName, minimalControls && "!size-7 !min-h-7 !px-0")}
            onClick={onOpenPlay}
          >
            <Play size={14} strokeWidth={1.9} /> <span data-toolbar-label className={toolbarLabelClassName}>Play</span>
          </button>
        ) : null}
      </div>

      <div
        ref={rightRef}
        className={cx(
          "flex shrink-0 items-center justify-self-end",
          minimalControls ? "gap-0.5" : "gap-1",
        )}
      >
        {!minimalControls ? <div className="contents">
          <button
            type="button"
            aria-label="Undo"
            title="Undo (⌘Z)"
            disabled={!canUndo}
            className={cx(editorUi.iconButton, minimalControls && "!size-7")}
            onClick={() => mutateAndSave(() => editorStore.getState().undo())}
          >
            <Undo2 size={15} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
            disabled={!canRedo}
            className={cx(editorUi.iconButton, minimalControls && "!size-7")}
            onClick={() => mutateAndSave(() => editorStore.getState().redo())}
          >
            <Redo2 size={15} strokeWidth={1.9} />
          </button>
        </div> : null}
        {!localeOverflowed && activeLocale && localeOptions.length > 0 ? (
          <div className={toolbarMotion}>
            <ToolbarLocaleSelect activeLocale={activeLocale} localeOptions={localeOptions} />
          </div>
        ) : null}
        {!secondaryOverflowed ? (
          <div className={cx("contents", toolbarMotion)}>
            {onOpenIssues ? (
              <ToolbarIssuesButton
                issueCounts={issueCounts}
                compact={compactControls}
                labelClassName={toolbarLabelClassName}
                onOpen={onOpenIssues}
              />
            ) : null}
            <button
              type="button"
              aria-label="Inspect"
              aria-pressed={inspectorOpen}
              className={cx(
                inspectorOpen ? editorUi.buttonGhostActive : editorUi.buttonGhost,
                compactSharedButtonClassName,
              )}
              onClick={onToggleInspector}
            >
              <PanelRight size={15} strokeWidth={1.9} /> <span data-toolbar-label className={toolbarLabelClassName}>Inspect</span>
            </button>
          </div>
        ) : null}
        <button
          ref={exportRef}
          type="button"
          aria-label={exportLabel}
          title={exportLabel}
          className={cx(
            editorUi.buttonPrimary,
            compactSharedButtonClassName,
            minimalControls && "!size-7 !min-h-7 !px-0",
          )}
          onClick={() => setExportOpen(true)}
        >
          <Download size={15} strokeWidth={2} /> <span data-toolbar-label className={toolbarLabelClassName}>Export</span>
          {exportCount !== null && !minimalControls ? (
            <span
              aria-hidden="true"
              className={cx("rounded-md bg-white/20 px-1.5 text-[11px] font-semibold tabular-nums", compactControls && "ml-1.5")}
            >{exportCount}</span>
          ) : null}
        </button>
        {secondaryOverflowed ? (
          <div ref={overflowRef} className={toolbarMotion}>
            <ToolbarOverflowMenu
              density={density}
              open={overflowOpen}
              onOpenChange={setOverflowOpen}
              triggerRef={overflowTriggerRef}
              inspectorOpen={inspectorOpen}
              issuesLabel={onOpenIssues ? toolbarIssuesLabel(issueCounts) : undefined}
              issueCount={issueTotal}
              onOpenIssues={onOpenIssues}
              activeLocale={activeLocale}
              localeOptions={localeOptions}
              onToggleInspector={onToggleInspector}
              onLocaleChange={(locale) => editorStore.getState().selectLocale(locale)}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={() => mutateAndSave(() => editorStore.getState().undo())}
              onRedo={() => mutateAndSave(() => editorStore.getState().redo())}
            />
          </div>
        ) : null}
      </div>

      <ExportDialog
        key={activeLayout?.id ?? "no-layout"}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        specs={specs}
        issues={issues}
        onGoToScreen={(screenId) => {
          editorStore.getState().selectScreen(screenId);
          onViewChange("focus");
        }}
        onOpenIssues={onOpenIssues}
      />
    </header>
  );
}
