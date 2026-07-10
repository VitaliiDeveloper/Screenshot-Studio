"use client";

import dynamic from "next/dynamic";
import { useStore } from "zustand";
import { Plus, Trash2 } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { editorStore } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { SortableRow } from "./SortableRow";
import { editorUi } from "./editor-ui";

const DynamicScreenThumbnail = dynamic(
  () => import("./ScreenThumbnail").then((module) => module.ScreenThumbnail),
  { ssr: false },
);

/** Screens list: select active, dnd reorder (= project.screens order), duplicate-add, delete. */
export function ScreensSection({ images }: { images: ImageCache }) {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (!project) return null;
  const screens = project.screens;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = screens.findIndex((s) => s.id === e.active.id);
    const to = screens.findIndex((s) => s.id === e.over!.id);
    mutateAndSave(() => editorStore.getState().reorderScreens(from, to));
  };

  const onDelete = (id: string, name: string) => {
    if (screens.length <= 1) return; // last screen is not deletable
    if (!window.confirm(`Delete screen "${name}" and all its layers?`)) return;
    mutateAndSave(() => editorStore.getState().removeScreen(id));
  };

  return (
    <section className="border-b border-slate-200 pb-2">
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Screens</h2>
        <button
          onClick={() => mutateAndSave(() => editorStore.getState().addScreen())}
          className={`${editorUi.buttonGhost} text-blue-600 hover:bg-blue-50 hover:text-blue-700`}
        >
          <Plus size={14} strokeWidth={2} /> Add
        </button>
      </header>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={screens.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div role="list" aria-label="Screens">
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
                  aria-label={`${s.name} · ${s.device}`}
                  aria-current={s.id === activeScreenId ? "true" : undefined}
                  className={`min-w-0 flex-1 rounded-md px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${
                    s.id === activeScreenId ? "text-blue-700" : "text-slate-700"
                  }`}
                >
                  <span className="block truncate text-xs font-semibold">{s.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                    {s.device} · {s.artboard.width}×{s.artboard.height}
                  </span>
                </button>
                <button
                  onClick={() => onDelete(s.id, s.name)}
                  disabled={screens.length <= 1}
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
