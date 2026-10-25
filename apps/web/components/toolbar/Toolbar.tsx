// SPDX-License-Identifier: Apache-2.0
"use client";

import { useMemo } from "react";
import { useStore } from "zustand";
import {
  Download,
  LayoutGrid,
  PanelsTopLeft,
  PanelRight,
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
  exportOpen,
  onExportOpenChange,
  specs = DEFAULT_STORE_SPECS,
  issueCounts = NO_ISSUES,
  issues,
  onOpenIssues,
  editingLocked = false,
}: {
  view: WorkspaceView;
  inspectorOpen: boolean;
  onViewChange: (view: WorkspaceView) => void;
  onToggleInspector: () => void;
  onOpenProjects: () => void;
  projectsBusy?: boolean;
  exportOpen: boolean;
  onExportOpenChange: (open: boolean) => void;
  specs?: StoreSpecs;
  issueCounts?: IssueCounts;
  issues?: readonly ProjectIssue[];
  onOpenIssues?: () => void;
  /** An agent run owns the project: Undo, Redo, Export, and leaving for Projects wait for it. */
  editingLocked?: boolean;
}) {
  const projectName = useStore(editorStore, (state) => state.project?.meta.name ?? "Untitled project");
  const activeLayout = useStore(editorStore, selectEditorLayout);
  const locales = activeLayout ? layoutLocales(activeLayout) : EMPTY_LOCALES;
  const activeLocale = useStore(editorStore, (state) =>
    state.project?.layouts.find((layout) => layout.id === state.activeLayoutId)?.screens
      .find((screen) => screen.id === state.activeScreenId)?.locale
      ?? state.project?.layouts.find((layout) => layout.id === state.activeLayoutId)?.screens[0]?.locale
      ?? "",
  );
  const canUndo = useStore(editorStore, (state) => state.historyPast.length > 0) && !editingLocked;
  const canRedo = useStore(editorStore, (state) => state.historyFuture.length > 0) && !editingLocked;
  const exportCount = useStore(editorStore, (state) => exportFileCount(state.project, state.activeLayoutId, specs));
  const exportLabel = exportButtonLabel(exportCount);
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
        "relative grid min-h-13 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-5 border-b border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-3 shadow-[0_1px_0_rgba(15,23,42,0.02)] sm:px-4",
        !densityReady && "invisible",
      )}
    >
      <div className="flex w-full min-w-0 items-center justify-self-start">
        <div ref={leftRef} data-toolbar-left-content className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            aria-label="Screenshot Studio, back to Projects"
            title="Back to Projects"
            disabled={projectsBusy || editingLocked}
            className="hidden shrink-0 items-center gap-2.5 rounded-lg text-[color:var(--editor-color-text-strong)] transition-colors hover:text-[color:var(--editor-color-accent-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] disabled:cursor-wait disabled:opacity-60 sm:inline-flex"
            onClick={onOpenProjects}
          >
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-[var(--editor-color-accent)] text-[color:var(--editor-color-on-accent)] shadow-sm shadow-blue-600/20">
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
          <span className="hidden text-xs text-[color:var(--editor-color-text-faint)] xl:inline" aria-hidden="true">/</span>
          <span className="hidden max-w-48 truncate whitespace-nowrap text-xs font-medium text-[color:var(--editor-color-text-muted)] xl:inline">{projectName}</span>
          <span className="hidden text-xs text-[color:var(--editor-color-text-faint)] xl:inline" aria-hidden="true">/</span>
          {/* Its menu adds, renames, and removes layouts, which an agent run must not race. */}
          <div className="contents" inert={editingLocked ? true : undefined}>
            <LayoutSelector />
          </div>
        </div>
      </div>

      <div
        ref={viewSwitchRef}
        className={cx(
          "flex items-center justify-self-center rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)]",
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
            "inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] lg:px-3",
            compactControls ? "gap-0" : "gap-1.5",
            view === "focus" ? "bg-[var(--editor-color-surface)] text-[color:var(--editor-color-text-strong)] shadow-sm ring-1 ring-[var(--editor-color-border)]" : "text-[color:var(--editor-color-text-secondary)] hover:text-[color:var(--editor-color-text)]",
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
            "inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] lg:px-3",
            compactControls ? "gap-0" : "gap-1.5",
            view === "overview" ? "bg-[var(--editor-color-surface)] text-[color:var(--editor-color-accent-text-strong)] shadow-sm ring-1 ring-[var(--editor-color-border)]" : "text-[color:var(--editor-color-text-secondary)] hover:text-[color:var(--editor-color-text)]",
          )}
          onClick={() => onViewChange("overview")}
        >
          <LayoutGrid size={14} strokeWidth={1.9} /> <span data-toolbar-label className={toolbarLabelClassName}>Overview</span>
        </button>
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
                disabled={editingLocked}
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
          disabled={editingLocked}
          className={cx(
            editorUi.buttonPrimary,
            compactSharedButtonClassName,
            minimalControls && "!size-7 !min-h-7 !px-0",
          )}
          onClick={() => onExportOpenChange(true)}
        >
          <Download size={15} strokeWidth={2} /> <span data-toolbar-label className={toolbarLabelClassName}>Export</span>
          {exportCount !== null && !minimalControls ? (
            <span
              aria-hidden="true"
              className={cx("rounded-md bg-[var(--editor-color-on-accent-subtle)] px-1.5 text-[11px] font-semibold tabular-nums", compactControls && "ml-1.5")}
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
              onOpenIssues={editingLocked ? undefined : onOpenIssues}
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
        onClose={() => onExportOpenChange(false)}
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
