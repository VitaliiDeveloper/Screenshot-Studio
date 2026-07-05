"use client";

import { useStore } from "zustand";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { editorStore } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { SortableRow } from "./SortableRow";

/** Screens list: select active, dnd reorder (= project.screens order), duplicate-add, delete. */
export function ScreensSection() {
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
    <section className="border-b border-neutral-200">
      <header className="flex items-center justify-between px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Screens</h2>
        <button
          onClick={() => mutateAndSave(() => editorStore.getState().addScreen())}
          className="rounded px-2 py-0.5 text-sm text-blue-600 hover:bg-blue-50"
        >
          + Add
        </button>
      </header>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={screens.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {screens.map((s) => (
            <SortableRow key={s.id} id={s.id}>
              <button
                onClick={() => editorStore.getState().selectScreen(s.id)}
                className={`flex-1 truncate text-left text-sm ${
                  s.id === activeScreenId ? "font-semibold text-blue-700" : "text-neutral-700"
                }`}
              >
                {s.name} <span className="text-neutral-400">· {s.device}</span>
              </button>
              <button
                onClick={() => onDelete(s.id, s.name)}
                disabled={screens.length <= 1}
                aria-label={`Delete ${s.name}`}
                className="text-neutral-400 hover:text-red-600 disabled:opacity-30"
              >
                ✕
              </button>
            </SortableRow>
          ))}
        </SortableContext>
      </DndContext>
    </section>
  );
}
