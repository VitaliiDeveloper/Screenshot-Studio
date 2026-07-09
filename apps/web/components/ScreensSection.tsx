"use client";

import { useStore } from "zustand";
import { Plus, Trash2 } from "lucide-react";
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
import { editorUi } from "./editor-ui";

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
          {screens.map((s) => (
            <SortableRow key={s.id} id={s.id} className={s.id === activeScreenId ? "bg-blue-50 ring-1 ring-blue-100" : undefined}>
              <button
                onClick={() => editorStore.getState().selectScreen(s.id)}
                className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${
                  s.id === activeScreenId ? "font-semibold text-blue-700" : "font-medium text-slate-700"
                }`}
              >
                {s.name} <span className="text-neutral-400">· {s.device}</span>
              </button>
              <button
                onClick={() => onDelete(s.id, s.name)}
                disabled={screens.length <= 1}
                aria-label={`Delete ${s.name}`}
                className={`${editorUi.iconButton} hover:bg-red-50 hover:text-red-600`}
              >
                <Trash2 size={14} strokeWidth={1.8} />
              </button>
            </SortableRow>
          ))}
        </SortableContext>
      </DndContext>
    </section>
  );
}
