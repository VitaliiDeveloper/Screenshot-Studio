"use client";

import type { AriaRole, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cx } from "./editor-ui";

/**
 * One draggable row for a sortable list. The drag handle is a dedicated span (so buttons/inputs
 * inside the row stay clickable); a KeyboardSensor on the parent DndContext makes the handle
 * focusable and reorderable with the keyboard (also what the e2e drives, deterministically).
 */
export function SortableRow({
  id,
  children,
  className,
  role,
  ariaLevel,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  role?: AriaRole;
  ariaLevel?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      role={role}
      aria-level={ariaLevel}
      className={cx(
        "group mx-2 my-0.5 flex min-h-9 items-center gap-1 rounded-lg px-1.5 transition-colors hover:bg-slate-50",
        className,
      )}
    >
      <span
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="inline-flex size-7 cursor-grab select-none items-center justify-center rounded-md text-slate-300 transition-colors hover:bg-white hover:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
      >
        <GripVertical size={14} strokeWidth={1.8} />
      </span>
      {children}
    </div>
  );
}
