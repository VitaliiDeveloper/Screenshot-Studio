// SPDX-License-Identifier: Apache-2.0
"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { CornerUpLeft, Trash2 } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { groupScreensByOutput, workspaceScreenScope } from "../lib/editor-workspace";
import { editorStore } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { SortableRow } from "./SortableRow";
import { AddMenu, editorUi, MenuSelect } from "./editor-ui";
import type { ResourceDialog } from "../lib/editor-workspace";

const DynamicScreenThumbnail = dynamic(
  () => import("./ScreenThumbnail").then((module) => module.ScreenThumbnail),
  { ssr: false },
);

/** Active connected group (or isolated locale): select, scoped reorder, duplicate-add, and delete. */
export function ScreensSection({
  images,
  onOpenDialog,
}: {
  images: ImageCache;
  onOpenDialog: (dialog: ResourceDialog) => void;
}) {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const screenListRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useEffect(() => {
    if (!activeScreenId) return;
    const id = requestAnimationFrame(() => {
      const list = screenListRef.current;
      if (!list) return;
      const activeButton = Array.from(
        list.querySelectorAll<HTMLButtonElement>("button[data-screen-id]"),
      ).find((button) => button.dataset.screenId === activeScreenId);
      const row = activeButton?.closest<HTMLElement>("[role='listitem']");
      if (!row) return;

      const listRect = list.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const fullyVisible = rowRect.top >= listRect.top && rowRect.bottom <= listRect.bottom;
      if (fullyVisible) return;

      list.scrollTo({
        top: list.scrollTop + rowRect.top - listRect.top - (list.clientHeight - rowRect.height) / 2,
        behavior: "smooth",
      });
    });
    return () => cancelAnimationFrame(id);
  }, [activeScreenId]);
  if (!project) return null;
  const activeScreen = project.screens.find((screen) => screen.id === activeScreenId);
  const activeLocale = activeScreen?.locale ?? project.locales[0]!;
  const screens = activeScreen
    ? workspaceScreenScope(project, activeScreen)
    : project.screens.filter((screen) => screen.locale === activeLocale);
  const localeRootScreenCount = project.screens.filter((screen) =>
    screen.locale === activeLocale && screen.variantOf === undefined,
  ).length;
  const activeRoot = activeScreen?.variantOf
    ? project.screens.find((screen) => screen.id === activeScreen.variantOf)
    : undefined;
  const scopeLabel = project.mode === "connected" && activeScreen
    ? `${activeLocale} · ${activeScreen.device}${activeScreen.storeTargetId ? ` · ${activeScreen.storeTargetId}` : ""}`
    : `${activeLocale}${activeScreen?.storeTargetId ? ` · ${activeScreen.storeTargetId}` : ""}`;
  const outputRows = project.mode === "isolated" && activeScreen && activeScreen.variantOf === undefined
    ? groupScreensByOutput(screens)
    : [];
  const activeOutputKey = activeScreen ? `${activeScreen.platform}/${activeScreen.device}` : "";
  const showOutputSwitcher = outputRows.length > 1;
  const visibleOutput = showOutputSwitcher
    ? outputRows.find((row) => row.key === activeOutputKey) ?? outputRows[0]!
    : undefined;
  const visibleScreens = visibleOutput?.screens ?? screens;
  const listLabel = visibleOutput
    ? `Screens for ${activeLocale} · ${visibleOutput.label}`
    : project.mode === "connected" && activeScreen
      ? `Screens for ${activeLocale} ${activeScreen.device} group`
      : `Screens for ${activeLocale}`;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    mutateAndSave(() => editorStore.getState().reorderScreens(String(e.active.id), String(e.over!.id)));
  };

  const onDelete = (id: string, name: string) => {
    const candidate = project.screens.find((screen) => screen.id === id);
    if (!candidate) return;
    if (candidate.variantOf === undefined && localeRootScreenCount <= 1) return;
    const variants = project.screens.filter((screen) => screen.variantOf === id).length;
    const suffix = variants > 0 ? ` and ${variants} store target variant${variants === 1 ? "" : "s"}` : "";
    if (!window.confirm(`Delete screen "${name}"${suffix} and all its layers?`)) return;
    mutateAndSave(() => editorStore.getState().removeScreen(id));
  };

  return (
    <section className="border-b border-slate-200 pb-2">
      <header className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Screens</h2>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">{scopeLabel}</span>
        </div>
        {activeRoot ? (
          <button
            type="button"
            aria-label="Return to master"
            title="Return to master"
            onClick={() => editorStore.getState().selectScreen(activeRoot.id)}
            className={`${editorUi.buttonGhost} h-6 min-h-6 px-1.5 text-blue-600 hover:bg-blue-50 hover:text-blue-700`}
          >
            <CornerUpLeft size={14} strokeWidth={2} />
            Master
          </button>
        ) : (
          <AddMenu
            ariaLabel="Add screen"
            menuLabel="Add screen options"
            options={[
              { value: "duplicate", label: "Duplicate current", description: "Copy the current screen and its layers" },
              { value: "blank", label: "Blank screen", description: "Keep this output size with no layers" },
              { value: "template", label: "From template", description: "Create from a project template" },
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
        )}
      </header>
      {showOutputSwitcher ? (
        <div className="border-y border-slate-200/70 bg-slate-50/80 px-3 py-2">
          <MenuSelect
            ariaLabel={`Output family for ${activeLocale}`}
            menuLabel={`Output family options for ${activeLocale}`}
            value={activeOutputKey}
            options={outputRows.map((row) => ({
              value: row.key,
              label: `${row.label} · ${row.screens.length}`,
              triggerLabel: `${row.label.replace(" · ", " / ")} · ${row.screens.length} ${row.screens.length === 1 ? "screen" : "screens"}`,
            }))}
            onChange={(outputKey) => {
              const output = outputRows.find((row) => row.key === outputKey);
              if (output) editorStore.getState().selectScreen(output.screens[0]!.id);
            }}
            density="compact"
            appearance="breadcrumb"
            className="w-full"
            menuClassName="w-full"
          />
        </div>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visibleScreens.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div
            ref={screenListRef}
            role="list"
            aria-label={listLabel}
            className="max-h-64 overflow-y-auto overscroll-contain pt-2 [scrollbar-gutter:stable]"
          >
            {visibleScreens.map((s, index) => (
              <SortableRow
                key={s.id}
                id={s.id}
                role="listitem"
                className={`min-h-[3.25rem] py-1 ${s.id === activeScreenId ? "bg-blue-50 ring-1 ring-blue-100" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`relative inline-flex h-12 w-7 shrink-0 items-center justify-center overflow-visible rounded-md border bg-slate-900 text-white shadow-sm ${
                    s.id === activeScreenId
                      ? "border-blue-300 ring-2 ring-blue-200/70"
                      : "border-slate-300"
                  }`}
                >
                  <DynamicScreenThumbnail project={project} screenId={s.id} images={images} />
                  <span className="absolute -bottom-1 -right-1 inline-flex size-4 items-center justify-center rounded-full border border-white bg-slate-700 text-[8px] font-semibold leading-none text-white">
                    {index + 1}
                  </span>
                </span>
                <button
                  onClick={() => editorStore.getState().selectScreen(s.id)}
                  data-screen-id={s.id}
                  aria-label={`${s.name} · ${s.device}`}
                  aria-current={s.id === activeScreenId ? "true" : undefined}
                  className={`min-w-0 flex-1 rounded-md px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${
                    s.id === activeScreenId ? "text-blue-700" : "text-slate-700"
                  }`}
                >
                  <span className="block truncate text-xs font-semibold">{s.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-600">
                    {s.device} · {s.locale}{s.storeTargetId ? ` · ${s.storeTargetId}` : ""} · {s.artboard.width}×{s.artboard.height}
                  </span>
                </button>
                <button
                  onClick={() => onDelete(s.id, s.name)}
                  disabled={s.variantOf === undefined && localeRootScreenCount <= 1}
                  aria-label={`Delete ${s.name}`}
                  className={`${editorUi.iconButton} opacity-0 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus-visible:opacity-100`}
                >
                  <Trash2 size={14} strokeWidth={1.8} />
                </button>
              </SortableRow>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
