// SPDX-License-Identifier: Apache-2.0
"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useStore } from "zustand";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ImageCache } from "@screenshot-studio/core/assets";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import {
  assertNever,
  isPrimaryScreen,
  sameScreenGroup,
  screenSetModeFor,
  slotScreens,
  type DesignLayout,
  type Screen,
} from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import {
  outputFamilyEditorLabel,
  workspaceEditingScope,
  workspaceOverviewRows,
  type ResourceDialog,
  type WorkspaceView,
} from "@web/lib/editor/editor-workspace";
import { editorStore, selectEditorLayout } from "@web/lib/editor/editor-store";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";
import type { SearchResult } from "@web/lib/editor/editor-search";
import { compactSizeLabel, screenSizeLabel, screenTreeSummary, sizeCountLabel } from "@web/lib/panel-helpers";
import { LayerSearch } from "./LayerSearch";
import { LayersSection } from "./LayersSection";
import { rowHoverControl, SortableRow, treeRowButton } from "./SortableRow";
import { AddMenu, ConfirmationDialog, cx, editorUi } from "./editor-ui";

const DynamicScreenThumbnail = dynamic(
  () => import("./ScreenThumbnail").then((module) => module.ScreenThumbnail),
  { ssr: false },
);

/** The Screens header scope: `3 · EN · iPhone 6.9"` in Focus, `3 · EN · 4 sizes` in Overview. */
export function screensScopeLabel(
  layout: DesignLayout,
  screens: readonly Screen[],
  scopeScreen: Screen | undefined,
  locale: string,
  view: WorkspaceView,
  specs: StoreSpecs,
): string {
  const scope = !scopeScreen
    ? []
    : view === "overview"
      ? [sizeCountLabel(workspaceOverviewRows(layout, scopeScreen, specs).length)]
      : [screenSizeLabel(scopeScreen, specs)];
  return [String(screens.length), locale.toUpperCase(), ...scope].join(" · ");
}

/**
 * A screen row's warning: the first issue on any size of its slot, e.g. `Dynamic Island · Medium: text overflows`,
 * with how many more there are; null when the slot has none.
 */
export function screenRowWarning(
  layout: DesignLayout,
  screen: Screen,
  issues: readonly ProjectIssue[],
  specs: StoreSpecs,
): string | null {
  const slot = slotScreens(layout, screen);
  const onSize = (screenId: string, problem: string) => {
    const target = slot.find((candidate) => candidate.id === screenId);
    return target ? [`${compactSizeLabel(target, specs) ?? target.name}: ${problem}`] : [];
  };
  const lines = issues.flatMap((issue) => {
    if (issue.layoutId !== layout.id) return [];
    switch (issue.kind) {
      case "missing-locale-screen":
        return slot.some((candidate) => candidate.id === issue.sourceScreenId)
          ? [`${issue.locale.toUpperCase()}: screen missing`]
          : [];
      case "missing-image":
        return onSize(issue.screenId, "image missing");
      case "text-overflow":
        return onSize(issue.screenId, "text overflows");
      default:
        return assertNever(issue);
    }
  });
  if (lines.length === 0) return null;
  return lines.length === 1 ? lines[0]! : `${lines[0]} · ${lines.length - 1} more`;
}

/** Grows or shrinks a screen's nested layers; nothing animates until the expanded screen first changes. */
function TreeCollapse({
  id,
  open,
  animate,
  onClosed,
  children,
}: {
  id: string;
  open: boolean;
  animate: boolean;
  onClosed: (id: string) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || (open && !animate)) return;
    const height = `${node.scrollHeight}px`;
    const animation = node.animate(
      [
        { height: open ? "0px" : height, opacity: open ? 0 : 1, overflow: "hidden" },
        { height: open ? height : "0px", opacity: open ? 1 : 0, overflow: "hidden" },
      ],
      {
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: open ? "none" : "forwards",
      },
    );
    if (!open) animation.finished.then(() => onClosed(id), () => undefined);
    return () => animation.cancel();
  }, [animate, id, onClosed, open]);
  return (
    <div ref={ref} inert={!open} aria-hidden={open ? undefined : true}>
      {children}
    </div>
  );
}

/** A screen row's select button: name over its caption, which the accessible name refers to. */
export function ScreenRowButton({
  name,
  caption,
  active,
  warning,
  className,
  ...props
}: {
  name: string;
  caption: string;
  active: boolean;
  warning: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-describedby" | "aria-current">) {
  const captionId = useId();
  return (
    <button
      type="button"
      {...props}
      aria-describedby={captionId}
      aria-current={active ? "true" : undefined}
      className={cx(
        "flex min-w-0 flex-1 flex-col gap-0.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-[var(--editor-color-focus)]",
        className,
      )}
    >
      <span
        className={cx(
          "block truncate text-[13px]",
          active ? "font-semibold" : "font-medium",
          warning
            ? "text-[color:var(--editor-color-warning-text)]"
            : active
              ? "text-[color:var(--editor-color-accent-hover)]"
              : "text-[color:var(--editor-color-text-strong)]",
        )}
      >
        {name}
      </span>
      <span
        id={captionId}
        className={cx(
          "block truncate text-[11px]",
          warning
            ? "text-[color:var(--editor-color-warning-text)]"
            : active
              ? "text-[color:var(--editor-color-text-muted)]"
              : "text-[color:var(--editor-color-text-secondary)]",
        )}
      >
        {caption}
      </span>
    </button>
  );
}

/**
 * Screens → Layers tree for the active exact output group: select, scoped reorder, add, and delete
 * screens; the active screen expands to its layers.
 */
export function ScreensSection({
  images,
  view,
  specs,
  issues,
  onOpenDialog,
  onImportCaptures,
  onOpenAdd,
  searchOpen,
  onSearchOpenChange,
}: {
  images: ImageCache;
  view: WorkspaceView;
  specs: StoreSpecs;
  /** Feeds the warning variant of a screen row. */
  issues: readonly ProjectIssue[];
  onOpenDialog: (dialog: ResourceDialog) => void;
  onImportCaptures: () => void;
  onOpenAdd: () => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
}) {
  const project = useStore(editorStore, (s) => s.project);
  const layout = useStore(editorStore, selectEditorLayout);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedItems = useStore(editorStore, (s) => s.selectedItems);
  const [dismissedOnboardingScreenId, setDismissedOnboardingScreenId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; description: string } | null>(null);
  // Keyed by screen: collapsing one never hides the layers of a screen activated from the canvas.
  const [collapsedScreenId, setCollapsedScreenId] = useState<string | null>(null);
  const [draggingScreen, setDraggingScreen] = useState(false);
  // The previously expanded screen keeps its layers mounted while they collapse.
  const expandedScreenId = activeScreenId !== null && collapsedScreenId !== activeScreenId ? activeScreenId : null;
  const [shownExpandedScreenId, setShownExpandedScreenId] = useState(expandedScreenId);
  const [closingScreenId, setClosingScreenId] = useState<string | null>(null);
  const [treeAnimates, setTreeAnimates] = useState(false);
  if (shownExpandedScreenId !== expandedScreenId) {
    setShownExpandedScreenId(expandedScreenId);
    setClosingScreenId(shownExpandedScreenId);
    setTreeAnimates(true);
  }
  const finishClosing = useCallback((id: string) => {
    setClosingScreenId((current) => (current === id ? null : current));
  }, []);
  const screenListRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useEffect(() => {
    if (!activeScreenId) return;
    const id = requestAnimationFrame(() => {
      const activeButton = Array.from(
        screenListRef.current?.querySelectorAll<HTMLButtonElement>("button[data-screen-id]") ?? [],
      ).find((button) => button.dataset.screenId === activeScreenId);
      activeButton?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [activeScreenId]);
  if (!project || !layout) return null;
  const activeScreen = layout.screens.find((screen) => screen.id === activeScreenId);
  const activeLocale = activeScreen?.locale ?? layout.screens[0]!.locale;
  const screens = activeScreen
    ? workspaceEditingScope(layout, activeScreen)
      .filter((screen) => sameScreenGroup(screen, activeScreen))
    : layout.screens.filter((screen) => screen.locale === activeLocale);
  const localeRootScreenCount = layout.screens.filter((screen) =>
    screen.locale === activeLocale && isPrimaryScreen(screen),
  ).length;
  const listLabel = activeScreen
    ? `Screens for ${activeLocale} · ${outputFamilyEditorLabel(activeScreen.platform, activeScreen.device, specs)}`
    : `Screens for ${activeLocale}`;
  const scopeLabel = screensScopeLabel(layout, screens, activeScreen ?? screens[0], activeLocale, view, specs);
  const firstRunScreen = layout.screens.length === 1 && layout.screens[0]!.elements.length === 0
    ? layout.screens[0]!
    : null;
  const firstRun = firstRunScreen !== null && dismissedOnboardingScreenId !== firstRunScreen.id;
  const deletionRootFor = (candidate: Screen): Screen => (
    screenSetModeFor(layout, candidate) === "synchronized" && candidate.variantOf
      ? layout.screens.find((screen) => screen.id === candidate.variantOf) ?? candidate
      : candidate
  );

  const onDragEnd = (e: DragEndEvent) => {
    setDraggingScreen(false);
    if (!e.over || e.active.id === e.over.id) return;
    mutateAndSave(() => editorStore.getState().reorderScreens(String(e.active.id), String(e.over!.id)));
  };

  const selectScreen = (id: string) => {
    setCollapsedScreenId(null);
    editorStore.getState().selectScreen(id);
  };

  const pickSearchResult = ({ screenId, elementId }: SearchResult) => {
    selectScreen(screenId);
    if (elementId) editorStore.getState().select(elementId, screenId);
  };

  const onDelete = (id: string, name: string) => {
    const candidate = layout.screens.find((screen) => screen.id === id);
    if (!candidate) return;
    const root = deletionRootFor(candidate);
    if (isPrimaryScreen(root) && localeRootScreenCount <= 1) return;
    const variants = layout.screens.filter((screen) => screen.variantOf === root.id).length;
    const synchronized = screenSetModeFor(layout, root) === "synchronized";
    const description = synchronized
      ? `Delete synchronized screen "${root.name}" from the primary size${variants > 0 ? ` and ${variants} exact size${variants === 1 ? "" : "s"}` : ""}? Layer content in every size will be removed.`
      : isPrimaryScreen(root) && variants > 0
        ? `Delete primary screen "${name}" and all its layers? ${variants} paired exact-size screen${variants === 1 ? " stays" : "s stay"} available as independent composition.`
        : `Delete screen "${name}" and all its layers?`;
    setPendingDelete({ id, description });
  };

  return (
    <section className="border-b border-[var(--editor-color-border)] pb-2">
      {firstRun ? (
        <div className="mx-3 mt-3 rounded-xl border border-[var(--editor-color-accent-muted)] bg-[var(--editor-color-accent-subtle)] p-3 text-xs text-[color:var(--editor-color-text-strong)]" data-testid="first-screen-onboarding">
          <h2 className="text-sm font-semibold">Your blank screen is ready</h2>
          <p className="mt-1 leading-5 text-[color:var(--editor-color-accent-strong)]">Keep this screen as-is, create a new editable screen from a built-in template, or import a folder of captures into this project.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={editorUi.buttonPrimary} onClick={() => onOpenDialog("templates")}>Create from template</button>
            <button type="button" className={editorUi.buttonSecondary} onClick={onImportCaptures}>Import capture folder</button>
            <button type="button" className={editorUi.buttonSecondary} onClick={() => setDismissedOnboardingScreenId(firstRunScreen!.id)}>Keep blank screen</button>
          </div>
        </div>
      ) : null}
      <header className="sticky top-0 z-10 flex flex-col gap-[9px] border-b border-[var(--editor-color-surface-muted)] bg-[var(--editor-color-surface)] px-3.5 pb-2.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className={cx(editorUi.sectionLabel, "flex min-w-0 items-baseline gap-1 font-semibold")}>
            <h2 className="shrink-0">Screens</h2>
            <span className="truncate" title={scopeLabel}>· {scopeLabel}</span>
          </div>
          <AddMenu
            ariaLabel="Add screen"
            menuLabel="Add screen options"
            options={[
              { value: "duplicate", label: "Duplicate current", description: "Copy the current screen and its layers" },
              { value: "blank", label: "Blank screen", description: "Keep this output size with no layers" },
              { value: "template", label: "From screen template", description: "Create from a screen template" },
            ]}
            onSelect={(action) => {
              if (action === "template") {
                onOpenDialog("templates");
                return;
              }
              mutateAndSave(() => {
                if (action === "blank") editorStore.getState().addBlankScreen();
                else editorStore.getState().addScreen();
              });
            }}
          />
        </div>
        <LayerSearch open={searchOpen} onOpenChange={onSearchOpenChange} screens={screens} onPick={pickSearchResult} />
      </header>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setDraggingScreen(true)}
        onDragCancel={() => setDraggingScreen(false)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={screens.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div ref={screenListRef} role="list" aria-label={listLabel} className="pt-2">
            {screens.map((s, index) => {
              const active = s.id === activeScreenId;
              const expanded = active && collapsedScreenId !== s.id;
              const selectedCount = selectedItems.filter((item) => item.screenId === s.id).length;
              const warning = screenRowWarning(layout, s, issues, specs);
              const deleteDisabled = isPrimaryScreen(deletionRootFor(s)) && localeRootScreenCount <= 1;
              const caption = warning ?? (view === "overview"
                ? sizeCountLabel(slotScreens(layout, s).length)
                : screenTreeSummary(s.elements.length, selectedCount));
              return (
                <SortableRow
                  key={s.id}
                  id={s.id}
                  role="listitem"
                  selected={active}
                  // The whole row selects its screen; its own controls keep their actions.
                  onClick={(event) => {
                    if (!(event.target as Element).closest("button, [role='button']")) selectScreen(s.id);
                  }}
                  className={cx(
                    "mx-2 my-px cursor-pointer gap-[9px] rounded-[9px] border px-2 py-1.5",
                    active
                      ? "border-[var(--editor-color-accent-muted)] bg-[var(--editor-color-accent-subtle)]"
                      : warning
                        ? "border-[var(--editor-color-warning-border)] bg-[var(--editor-color-warning-surface)]"
                        : "border-transparent hover:bg-[var(--editor-color-surface-subtle)]",
                  )}
                  nested={(expanded || closingScreenId === s.id) && !draggingScreen ? (
                    <TreeCollapse id={s.id} open={expanded} animate={treeAnimates} onClosed={finishClosing}>
                      <LayersSection onOpenAdd={onOpenAdd} screenId={s.id} />
                    </TreeCollapse>
                  ) : undefined}
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={expanded ? `Hide layers of ${s.name}` : `Show layers of ${s.name}`}
                    className={cx(
                      treeRowButton,
                      "-mx-1 text-[color:var(--editor-color-text-secondary)] hover:text-[color:var(--editor-color-text-strong)] focus-visible:ring-[var(--editor-color-focus)]",
                    )}
                    onClick={() => (active ? setCollapsedScreenId(expanded ? s.id : null) : selectScreen(s.id))}
                  >
                    {expanded ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
                  </button>
                  <span
                    aria-hidden="true"
                    className={cx(
                      "relative h-[46px] w-[22px] shrink-0 rounded border bg-[var(--editor-color-text-strong)]",
                      active
                        ? "border-[var(--editor-color-accent)]"
                        : warning
                          ? "border-dashed border-[var(--editor-color-warning-text)]"
                          : "border-[var(--editor-color-border-strong)]",
                    )}
                  >
                    <span className="absolute inset-0 overflow-hidden rounded-[3px]">
                      <DynamicScreenThumbnail project={project} layoutId={layout.id} screenId={s.id} images={images} />
                    </span>
                    {/* Export file names are numbered in this order (`01-…`), so the row keeps the number. */}
                    <span className="absolute -bottom-1 -right-1.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-[var(--editor-color-surface)] bg-[var(--editor-color-text-default)] px-0.5 text-[8px] font-semibold leading-none text-[color:var(--editor-color-on-accent)]">
                      {index + 1}
                    </span>
                  </span>
                  <ScreenRowButton
                    name={s.name}
                    caption={caption}
                    active={active}
                    warning={warning !== null}
                    onClick={() => selectScreen(s.id)}
                    data-screen-id={s.id}
                    aria-label={`${s.name} · ${outputFamilyEditorLabel(s.platform, s.device, specs)}`}
                  />
                  <button
                    type="button"
                    onClick={() => onDelete(s.id, s.name)}
                    disabled={deleteDisabled}
                    aria-label={`Delete ${s.name}`}
                    className={cx(
                      treeRowButton,
                      deleteDisabled ? "pointer-events-none opacity-0 group-hover:opacity-35" : rowHoverControl,
                      "text-[color:var(--editor-color-text-secondary)] hover:bg-[var(--editor-color-danger-surface)] hover:text-[color:var(--editor-color-danger)] focus-visible:ring-[var(--editor-color-focus)]",
                    )}
                  >
                    <Trash2 size={14} strokeWidth={1.8} />
                  </button>
                </SortableRow>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
      {pendingDelete ? (
        <ConfirmationDialog
          title="Delete screen?"
          description={pendingDelete.description}
          confirmLabel="Delete screen"
          onClose={() => setPendingDelete(null)}
          onConfirm={() => {
            const screenId = pendingDelete.id;
            setPendingDelete(null);
            mutateAndSave(() => editorStore.getState().removeScreen(screenId));
          }}
        />
      ) : null}
    </section>
  );
}
