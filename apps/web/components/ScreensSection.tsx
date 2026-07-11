// SPDX-License-Identifier: Apache-2.0
"use client";

import dynamic from "next/dynamic";
import { useStore } from "zustand";
import { CornerUpLeft, Plus, Trash2 } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { workspaceScreenScope } from "../lib/editor-workspace";
import { editorStore } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { SortableRow } from "./SortableRow";
import { editorUi } from "./editor-ui";

const DynamicScreenThumbnail = dynamic(
  () => import("./ScreenThumbnail").then((module) => module.ScreenThumbnail),
  { ssr: false },
);

/** Active connected group (or isolated locale): select, scoped reorder, duplicate-add, and delete. */
export function ScreensSection({ images }: { images: ImageCache }) {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
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
  const listLabel = project.mode === "connected" && activeScreen
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
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Screens</h2>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">{scopeLabel}</span>
        </div>
        <button
          onClick={() => activeRoot
            ? editorStore.getState().selectScreen(activeRoot.id)
            : mutateAndSave(() => editorStore.getState().addScreen())}
          className={`${editorUi.buttonGhost} text-blue-600 hover:bg-blue-50 hover:text-blue-700`}
        >
          {activeRoot ? <CornerUpLeft size={14} strokeWidth={2} /> : <Plus size={14} strokeWidth={2} />}
          {activeRoot ? "Master" : "Add"}
        </button>
      </header>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={screens.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div role="list" aria-label={listLabel}>
            {screens.map((s, index) => (
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
