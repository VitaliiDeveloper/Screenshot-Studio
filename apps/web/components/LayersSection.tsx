"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { Eye, EyeOff, Lock, LockOpen, Trash2 } from "lucide-react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { getScreen } from "@screenshot-studio/core/model";
import { editorStore, type ElementPatch } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { elementLabel, viewToArrayIndex } from "../lib/panel-helpers";
import { SortableRow } from "./SortableRow";
import { editorUi } from "./editor-ui";

/** Layers list for the active screen. Rendered reversed: top row = front-most = last in array. */
export function LayersSection() {
  const project = useStore(editorStore, (s) => s.project);
  const activeScreenId = useStore(editorStore, (s) => s.activeScreenId);
  const selectedId = useStore(editorStore, (s) => s.selectedId);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  if (!project || !activeScreenId) return null;
  const elements = getScreen(project, activeScreenId).elements;
  const rows = [...elements].reverse(); // top-of-list = front-most
  const len = elements.length;

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const fromView = rows.findIndex((el) => el.id === e.active.id);
    const toView = rows.findIndex((el) => el.id === e.over!.id);
    mutateAndSave(() =>
      editorStore.getState().reorderElements(viewToArrayIndex(len, fromView), viewToArrayIndex(len, toView)),
    );
  };

  const patch = (id: string, p: ElementPatch) =>
    mutateAndSave(() => editorStore.getState().patchElement(id, p));

  return (
    <section className="pb-3">
      <header className="px-4 py-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Layers</h2>
      </header>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((el) => el.id)} strategy={verticalListSortingStrategy}>
          {rows.map((el) => (
            <SortableRow key={el.id} id={el.id} className={el.id === selectedId ? "bg-blue-50 ring-1 ring-blue-100" : undefined}>
              {renaming?.id === el.id ? (
                <input
                  autoFocus
                  value={renaming.value}
                  onChange={(ev) => setRenaming({ id: el.id, value: ev.target.value })}
                  onBlur={() => { patch(el.id, { name: renaming.value }); setRenaming(null); }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") { patch(el.id, { name: renaming.value }); setRenaming(null); }
                    if (ev.key === "Escape") setRenaming(null);
                  }}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-blue-400 bg-white px-2 text-xs outline-none ring-2 ring-blue-500/15"
                />
              ) : (
                <button
                  onClick={() => editorStore.getState().select(el.id)}
                  onDoubleClick={() => setRenaming({ id: el.id, value: el.name ?? "" })}
                  className={`min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 ${
                    el.id === selectedId ? "font-semibold text-blue-700" : "text-neutral-700"
                  } ${el.visible ? "" : "text-slate-400 line-through"}`}
                >
                  {elementLabel(el)}
                </button>
              )}
              <button
                onClick={() => patch(el.id, { visible: !el.visible })}
                aria-label={el.visible ? "Hide layer" : "Show layer"}
                className={editorUi.iconButton}
              >
                {el.visible ? <Eye size={14} strokeWidth={1.8} /> : <EyeOff size={14} strokeWidth={1.8} />}
              </button>
              <button
                onClick={() => patch(el.id, { locked: !el.locked })}
                aria-label={el.locked ? "Unlock layer" : "Lock layer"}
                className={editorUi.iconButton}
              >
                {el.locked ? <Lock size={14} strokeWidth={1.8} /> : <LockOpen size={14} strokeWidth={1.8} />}
              </button>
              <button
                onClick={() => mutateAndSave(() => editorStore.getState().removeElement(el.id))}
                aria-label="Delete layer"
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
