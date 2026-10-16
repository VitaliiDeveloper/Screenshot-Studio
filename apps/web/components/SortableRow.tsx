// SPDX-License-Identifier: Apache-2.0
"use client";

import type { AriaRole, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cx, editorUi } from "./editor-ui";

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
  nested,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  role?: AriaRole;
  ariaLevel?: number;
  /** Content shown below the row that moves with it while the row is dragged. */
  nested?: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const rowClassName = cx(
    "group mx-3 my-0.5 flex min-h-9 items-center gap-1 rounded-lg px-1.5 transition-colors hover:bg-slate-50",
    className,
  );
  const row = (
    <>
      <span
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className={editorUi.dragHandle}
      >
        <GripVertical size={14} strokeWidth={1.8} />
      </span>
      {children}
    </>
  );
  if (nested !== undefined) {
    return (
      <div ref={setNodeRef} style={style} role={role} aria-level={ariaLevel}>
        <div className={rowClassName}>{row}</div>
        {nested}
      </div>
    );
  }
  return (
    <div ref={setNodeRef} style={style} role={role} aria-level={ariaLevel} className={rowClassName}>
      {row}
    </div>
  );
}
