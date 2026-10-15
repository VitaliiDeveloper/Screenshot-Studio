// SPDX-License-Identifier: Apache-2.0
"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
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
import {
  isPrimaryScreen,
  sameScreenGroup,
  screenSetModeFor,
  type Screen,
} from "@screenshot-studio/core/model";
import { outputFamilyEditorLabel, workspaceEditingScope } from "@web/lib/editor-workspace";
import { editorStore, selectEditorLayout } from "@web/lib/editor-store";
import { mutateAndSave } from "@web/lib/mutate-and-save";
import { screenTreeSummary } from "@web/lib/panel-helpers";
import { LayersSection } from "./LayersSection";
import { SortableRow } from "./SortableRow";
import { AddMenu, ConfirmationDialog, cx, editorUi } from "./editor-ui";
import type { ResourceDialog } from "@web/lib/editor-workspace";

const DynamicScreenThumbnail = dynamic(
  () => import("./ScreenThumbnail").then((module) => module.ScreenThumbnail),
  { ssr: false },
);

/**
 * Screens → Layers tree for the active exact output group: select, scoped reorder, add, and delete
 * screens; the active screen expands to its layers.
 */
export function ScreensSection({
  images,
  onOpenDialog,
  onImportCaptures,
  onOpenAdd,
}: {
  images: ImageCache;
  onOpenDialog: (dialog: ResourceDialog) => void;
  onImportCaptures: () => void;
  onOpenAdd: () => void;
}) {
  const project = useStore(editorStore, (s) => s.project);
  const layout = useStore(editorStore, selectEditorLayout);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedItems = useStore(editorStore, (s) => s.selectedItems);
  const [dismissedOnboardingScreenId, setDismissedOnboardingScreenId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; description: string } | null>(null);
  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const [draggingScreen, setDraggingScreen] = useState(false);
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
    ? `Screens for ${activeLocale} · ${activeScreen.device}`
    : `Screens for ${activeLocale}`;
  const scopeScreen = activeScreen ?? screens[0];
  const scopeLabel = [
    String(screens.length),
    activeLocale.toUpperCase(),
    ...(scopeScreen ? [outputFamilyEditorLabel(scopeScreen.platform, scopeScreen.device)] : []),
  ].join(" · ");
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
    setLayersCollapsed(false);
    editorStore.getState().selectScreen(id);
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
    <section className="border-b border-slate-200 pb-2">
      {firstRun ? (
        <div className="mx-3 mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950" data-testid="first-screen-onboarding">
          <h2 className="text-sm font-semibold">Your blank screen is ready</h2>
          <p className="mt-1 leading-5 text-blue-800">Keep this screen as-is, create a new editable screen from a built-in template, or import a folder of captures into this project.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={editorUi.buttonPrimary} onClick={() => onOpenDialog("templates")}>Create from template</button>
            <button type="button" className={editorUi.buttonSecondary} onClick={onImportCaptures}>Import capture folder</button>
            <button type="button" className={editorUi.buttonSecondary} onClick={() => setDismissedOnboardingScreenId(firstRunScreen!.id)}>Keep blank screen</button>
          </div>
        </div>
      ) : null}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-white px-3 py-3">
        <div className="flex min-w-0 items-baseline gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
          <h2 className="shrink-0">Screens</h2>
          <span className="truncate font-medium normal-case tracking-normal text-slate-500">· {scopeLabel}</span>
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
      </header>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setDraggingScreen(true)}
        onDragCancel={() => setDraggingScreen(false)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={screens.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div ref={screenListRef} role="list" aria-label={listLabel}>
            {screens.map((s, index) => {
              const active = s.id === activeScreenId;
              const expanded = active && !layersCollapsed;
              const selectedCount = selectedItems.filter((item) => item.screenId === s.id).length;
              return (
                <SortableRow
                  key={s.id}
                  id={s.id}
                  role="listitem"
                  className={cx("min-h-[3.25rem] py-1", active && "bg-blue-50 ring-1 ring-blue-100")}
                  nested={expanded && !draggingScreen ? <LayersSection onOpenAdd={onOpenAdd} /> : undefined}
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={expanded ? `Hide layers of ${s.name}` : `Show layers of ${s.name}`}
                    className={cx(editorUi.rowIconButton, "shrink-0")}
                    onClick={() => (active ? setLayersCollapsed(!layersCollapsed) : selectScreen(s.id))}
                  >
                    {expanded ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
                  </button>
                  <span
                    aria-hidden="true"
                    className={`relative inline-flex h-12 w-7 shrink-0 items-center justify-center overflow-visible rounded-md border bg-slate-900 text-white shadow-sm ${
                      s.id === activeScreenId
                        ? "border-blue-300 ring-2 ring-blue-200/70"
                        : "border-slate-300"
                    }`}
                  >
                    <DynamicScreenThumbnail project={project} layoutId={layout.id} screenId={s.id} images={images} />
                    <span className="absolute -bottom-1 -right-1 inline-flex size-4 items-center justify-center rounded-full border border-white bg-slate-700 text-[8px] font-semibold leading-none text-white">
                      {index + 1}
                    </span>
                  </span>
                  <button
                    onClick={() => selectScreen(s.id)}
                    data-screen-id={s.id}
                    aria-label={`${s.name} · ${s.device}`}
                    aria-current={active ? "true" : undefined}
                    className={`min-w-0 flex-1 rounded-md px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${
                      active ? "text-blue-700" : "text-slate-700"
                    }`}
                  >
                    <span className="block truncate text-xs font-semibold">{s.name}</span>
                    <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-600">
                      {screenTreeSummary(s.elements.length, selectedCount)}
                    </span>
                  </button>
                  <button
                    onClick={() => onDelete(s.id, s.name)}
                    disabled={isPrimaryScreen(deletionRootFor(s)) && localeRootScreenCount <= 1}
                    aria-label={`Delete ${s.name}`}
                    className={`${editorUi.iconButtonDanger} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
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
