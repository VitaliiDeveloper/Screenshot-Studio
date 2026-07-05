"use client";

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * One draggable row for a sortable list. The drag handle is a dedicated span (so buttons/inputs
 * inside the row stay clickable); a KeyboardSensor on the parent DndContext makes the handle
 * focusable and reorderable with the keyboard (also what the e2e drives, deterministically).
 */
export function SortableRow({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 px-2 py-1">
      <span
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="cursor-grab select-none text-neutral-400"
      >
        ⠿
      </span>
      {children}
    </div>
  );
}
