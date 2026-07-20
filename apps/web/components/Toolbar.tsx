// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  Download,
  LayoutGrid,
  Languages,
  PanelsTopLeft,
  PanelRight,
  Redo2,
  Scan,
  Undo2,
} from "lucide-react";
import { layoutLocales } from "@screenshot-studio/core/model";
import type { WorkspaceView } from "../lib/editor-workspace";
import { editorStore, selectEditorLayout } from "../lib/editor-store";
import { ExportDialog } from "./ExportDialog";
import { cx, editorUi, MenuSelect } from "./editor-ui";
import { mutateAndSave } from "../lib/mutate-and-save";
import { LayoutSelector } from "./LayoutSelector";
import {
  nextToolbarDensity,
  toolbarGap,
  resolveToolbarDensityProbe,
  toolbarDensityProbeTarget,
  type ToolbarDensity,
} from "./toolbar/toolbar-density";
import { ToolbarOverflowMenu } from "./toolbar/ToolbarOverflowMenu";

const EMPTY_LOCALES: string[] = [];
const toolbarMotion = "transition-opacity duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] [&_button]:duration-[var(--editor-motion-fast)] [&_button]:ease-[var(--editor-motion-ease)]";
const MAX_CACHED_CONTEXTS = 12;

interface ToolbarWidths {
  headerWidth: number;
  leftWidth: number;
  centerWidth: number;
  rightWidth: number;
}

type ToolbarDensityTransitionFocusTarget = "overflow-trigger" | "export" | null;

export function toolbarDensityProbeFocusRestoration({
  fallbackDensity,
  candidateDensity,
  resolvedDensity,
  fallbackFocusTarget,
}: {
  fallbackDensity: ToolbarDensity;
  candidateDensity: ToolbarDensity;
  resolvedDensity: ToolbarDensity;
  fallbackFocusTarget: ToolbarDensityTransitionFocusTarget;
}): ToolbarDensityTransitionFocusTarget {
  return resolvedDensity === fallbackDensity && resolvedDensity !== candidateDensity
    ? fallbackFocusTarget
    : null;
}

export function toolbarDensityTransitionFocusPolicy({
  nextDensity,
  overflowOpen,
  focusWithinOverflow,
  focusedItemRole,
}: {
  nextDensity: ToolbarDensity;
  overflowOpen: boolean;
  focusWithinOverflow: boolean;
  focusedItemRole: string | null;
}): {
  closeOverflow: boolean;
  focusTarget: ToolbarDensityTransitionFocusTarget;
} {
  const overflowRemoved = nextDensity === "full" || nextDensity === "compact";
  const focusedLocaleRadioRemoved =
    nextDensity === "overflow-secondary"
    && focusWithinOverflow
    && focusedItemRole === "menuitemradio";

  return {
    closeOverflow: overflowOpen && (overflowRemoved || focusedLocaleRadioRemoved),
    focusTarget: overflowRemoved && focusWithinOverflow
      ? "export"
      : focusedLocaleRadioRemoved
        ? "overflow-trigger"
        : null,
  };
}

function targetWidth(root: HTMLElement, labelsExpanded: boolean): number {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-toolbar-label]"))
    .filter((label) => getComputedStyle(label).display !== "none")
    .reduce(
      (width, label) => labelsExpanded
        ? width + Math.max(0, label.scrollWidth - label.clientWidth)
        : width - label.clientWidth,
      root.scrollWidth,
    );
}

export function Toolbar({
  view,
  inspectorOpen,
  onViewChange,
  onToggleInspector,
  onOpenLocales,
  exportRequestKey = 0,
}: {
  view: WorkspaceView;
  inspectorOpen: boolean;
  onViewChange: (view: WorkspaceView) => void;
  onToggleInspector: () => void;
  onOpenLocales: () => void;
  exportRequestKey?: number;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [density, setDensity] = useState<ToolbarDensity>("full");
  const [densityReady, setDensityReady] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const viewSwitchRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const localeRef = useRef<HTMLDivElement>(null);
  const secondaryRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLButtonElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowOpenRef = useRef(false);
  const densityProbeRef = useRef<{
    fallbackDensity: ToolbarDensity;
    candidateDensity: ToolbarDensity;
    fallbackFocusTarget: ToolbarDensityTransitionFocusTarget;
  } | null>(null);
  const pendingDensityFocusRef = useRef<ToolbarDensityTransitionFocusTarget>(null);
  const measurementCacheRef = useRef<{
    contentKey: string;
    widthsByContext: Map<ToolbarDensity, Map<string, ToolbarWidths>>;
  }>({ contentKey: "", widthsByContext: new Map() });
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
  const localeOptions = useMemo(
    () => locales.map((locale) => ({ value: locale, label: locale })),
    [locales],
  );
  const measurementContentKey = [
    projectName,
    activeLayout?.id ?? "",
    activeLayout?.name ?? "",
    activeLayout?.mode ?? "",
    activeLocale,
    ...localeOptions.flatMap((option) => [option.value, option.label]),
  ].join("\u0000");

  useEffect(() => {
    if (exportRequestKey <= 0) return;
    const frame = requestAnimationFrame(() => setExportOpen(true));
    return () => cancelAnimationFrame(frame);
  }, [exportRequestKey]);

  useLayoutEffect(() => {
    overflowOpenRef.current = overflowOpen;
  }, [overflowOpen]);

  useLayoutEffect(() => {
    const pendingFocusTarget = pendingDensityFocusRef.current;
    pendingDensityFocusRef.current = null;
    if (pendingFocusTarget === "overflow-trigger") {
      overflowTriggerRef.current?.focus();
    } else if (pendingFocusTarget === "export") {
      exportRef.current?.focus();
    }
  }, [density]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    const left = leftRef.current;
    const viewSwitch = viewSwitchRef.current;
    const right = rightRef.current;
    if (!header || !left || !viewSwitch || !right) return;

    const cache = measurementCacheRef.current;
    if (cache.contentKey !== measurementContentKey) {
      cache.contentKey = measurementContentKey;
      cache.widthsByContext.clear();
      densityProbeRef.current = null;
      pendingDensityFocusRef.current = null;
    }

    let frame = 0;
    const sync = () => {
      const style = getComputedStyle(header);
      const horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const columnGap = Number.parseFloat(style.columnGap) || 0;
      const labelsExpanded = density === "full";
      const currentWidths: ToolbarWidths = {
        headerWidth: header.clientWidth,
        leftWidth: targetWidth(left, labelsExpanded),
        centerWidth: targetWidth(viewSwitch, labelsExpanded),
        rightWidth: targetWidth(right, labelsExpanded),
      };
      const measurementContextKey = `${currentWidths.headerWidth}:${window.innerWidth}`;
      const widthsAtContexts = cache.widthsByContext.get(density) ?? new Map<string, ToolbarWidths>();
      widthsAtContexts.delete(measurementContextKey);
      widthsAtContexts.set(measurementContextKey, currentWidths);
      while (widthsAtContexts.size > MAX_CACHED_CONTEXTS) {
        const oldestContext = widthsAtContexts.keys().next().value;
        if (oldestContext === undefined) break;
        widthsAtContexts.delete(oldestContext);
      }
      cache.widthsByContext.set(density, widthsAtContexts);

      const gapFor = (widths: ToolbarWidths) => toolbarGap({
        headerWidth: currentWidths.headerWidth,
        horizontalPadding,
        columnGap,
        leftWidth: widths.leftWidth,
        centerWidth: widths.centerWidth,
        rightWidth: widths.rightWidth,
      });
      const currentGap = gapFor(currentWidths);
      const transitionTo = (nextDensity: ToolbarDensity) => {
        const focusWithinOverflow = overflowRef.current?.contains(document.activeElement) ?? false;
        const { closeOverflow, focusTarget } = toolbarDensityTransitionFocusPolicy({
          nextDensity,
          overflowOpen: overflowOpenRef.current,
          focusWithinOverflow,
          focusedItemRole: focusWithinOverflow
            ? document.activeElement?.getAttribute("role") ?? null
            : null,
        });
        if (closeOverflow) setOverflowOpen(false);
        if (focusTarget === "overflow-trigger") {
          overflowTriggerRef.current?.focus();
        } else if (focusTarget === "export") {
          exportRef.current?.focus();
        }
        setDensity(nextDensity);
        return focusTarget;
      };

      const activeProbe = densityProbeRef.current;
      if (activeProbe?.candidateDensity === density) {
        densityProbeRef.current = null;
        const resolvedDensity = resolveToolbarDensityProbe({
          ...activeProbe,
          candidateGap: currentGap,
        });
        pendingDensityFocusRef.current = toolbarDensityProbeFocusRestoration({
          ...activeProbe,
          resolvedDensity,
        });
        if (resolvedDensity !== density) {
          transitionTo(resolvedDensity);
          return;
        }
      } else if (activeProbe) {
        densityProbeRef.current = null;
      }

      const previousDensity = toolbarDensityProbeTarget(density);
      const previousWidths = previousDensity
        ? cache.widthsByContext.get(previousDensity)?.get(measurementContextKey)
        : null;
      const nextDensity = nextToolbarDensity({
        density,
        currentGap,
        previousGap: previousWidths ? gapFor(previousWidths) : null,
      });

      if (nextDensity !== density) {
        transitionTo(nextDensity);
        return;
      }

      if (previousDensity && !previousWidths) {
        const probe = {
          fallbackDensity: density,
          candidateDensity: previousDensity,
          fallbackFocusTarget: null as ToolbarDensityTransitionFocusTarget,
        };
        const transitionFocusTarget = transitionTo(previousDensity);
        probe.fallbackFocusTarget = transitionFocusTarget === "export"
          ? "overflow-trigger"
          : null;
        densityProbeRef.current = probe;
        return;
      }

      setDensityReady(true);
    };

    const scheduleSync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };

    sync();
    const observer = new ResizeObserver(scheduleSync);
    observer.observe(header);
    observer.observe(left);
    observer.observe(viewSwitch);
    observer.observe(right);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [density, measurementContentKey]);

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
        "relative grid min-h-14 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-5 border-b border-slate-200 bg-white px-3 shadow-[0_1px_0_rgba(15,23,42,0.02)] sm:px-4",
        !densityReady && "invisible",
      )}
    >
      <div className="flex w-full min-w-0 items-center justify-self-start">
        <div ref={leftRef} data-toolbar-left-content className="flex min-w-0 items-center gap-2.5">
          <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm shadow-blue-600/20 sm:inline-flex">
            <PanelsTopLeft size={16} strokeWidth={1.9} />
          </span>
          <span
            data-toolbar-label
            className={cx(
              "hidden overflow-hidden whitespace-nowrap text-sm font-semibold tracking-tight text-slate-950 transition-[max-width,opacity] duration-200 ease-out md:inline-block",
              compactControls ? "md:max-w-0 md:opacity-0" : "md:max-w-40 md:opacity-100",
            )}
          >Screenshot Studio</span>
          <span className="hidden h-5 w-px bg-slate-200 xl:block" aria-hidden="true" />
          <span className="hidden max-w-48 truncate whitespace-nowrap text-xs font-medium text-slate-600 xl:inline">{projectName}</span>
          <LayoutSelector />
        </div>
      </div>

      <div
        ref={viewSwitchRef}
        className={cx(
          "flex items-center justify-self-center rounded-xl border border-slate-200 bg-slate-50",
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
          <div ref={localeRef} className={toolbarMotion}>
            <MenuSelect
              ariaLabel={`Active locale: ${activeLocale}`}
              menuLabel="Project locales"
              value={activeLocale}
              options={localeOptions}
              onChange={(locale) => editorStore.getState().selectLocale(locale)}
              className="w-fit min-w-16 max-w-24"
              triggerClassName="h-8 px-2 font-semibold"
              menuClassName="w-32"
            />
          </div>
        ) : null}
        {!secondaryOverflowed ? (
          <div ref={secondaryRef} className={cx("contents", toolbarMotion)}>
            <button type="button" aria-label="Manage locales" className={editorUi.iconButton} onClick={onOpenLocales}>
              <Languages size={15} strokeWidth={1.9} />
            </button>
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
          aria-label="Export"
          title="Export"
          className={cx(
            editorUi.buttonPrimary,
            compactSharedButtonClassName,
            minimalControls && "!size-7 !min-h-7 !px-0",
          )}
          onClick={() => setExportOpen(true)}
        >
          <Download size={15} strokeWidth={2} /> <span data-toolbar-label className={toolbarLabelClassName}>Export</span>
        </button>
        {secondaryOverflowed ? (
          <div ref={overflowRef} className={toolbarMotion}>
            <ToolbarOverflowMenu
              density={density}
              open={overflowOpen}
              onOpenChange={setOverflowOpen}
              triggerRef={overflowTriggerRef}
              inspectorOpen={inspectorOpen}
              activeLocale={activeLocale}
              localeOptions={localeOptions}
              onToggleInspector={onToggleInspector}
              onOpenLocales={onOpenLocales}
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
      />
    </header>
  );
}
