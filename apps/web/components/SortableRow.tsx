// SPDX-License-Identifier: Apache-2.0
"use client";

import type { AriaRole, ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cx } from "./editor-ui";

/**
 * Row controls shown on hover and while focus is inside the row. Opacity, not display, hides them
 * so they stay focusable: Tab from the row reveals them for keyboard users. Without hover (touch),
 * hidden controls ignore taps; they unlock with focus inside the row or on the selected row, since
 * Safari does not focus a tapped button.
 */
export const rowHoverControl = [
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
  "[@media(hover:none)]:pointer-events-none [@media(hover:none)]:group-focus-within:pointer-events-auto",
  "[@media(hover:none)]:group-data-selected:pointer-events-auto [@media(hover:none)]:group-data-selected:opacity-100",
].join(" ");

/** A 24 px icon button for tree rows; callers add the color and a focus ring that fits the row fill. */
export const treeRowButton = "inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--editor-radius-compact)] transition-colors duration-[var(--editor-motion-fast)] focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)]";

/**
 * One draggable row for a sortable list. The drag handle is a dedicated span (so buttons/inputs
 * inside the row stay clickable); a KeyboardSensor on the parent DndContext makes the handle
 * focusable and reorderable with the keyboard (also what the e2e drives, deterministically).
 * The handle sits at the row end, before `trailing`, and shows on hover or focus within the row.
 */
export function SortableRow({
  id,
  children,
  trailing,
  className,
  handleClassName,
  hideHandle = false,
  selected = false,
  role,
  ariaLevel,
  nested,
}: {
  id: string;
  children: ReactNode;
  /** Always-visible controls after the drag handle, e.g. a layer's lock. */
  trailing?: ReactNode;
  className?: string;
  /** Handle color and focus ring for the row fill. */
  handleClassName?: string;
  /** Drops the handle, e.g. while the row is renamed. */
  hideHandle?: boolean;
  /** The selected or active row: on touch its hover controls stay available. */
  selected?: boolean;
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
    "group relative flex items-center transition-colors duration-[var(--editor-motion-fast)]",
    className,
  );
  const row = (
    <>
      {children}
      {hideHandle ? null : <span
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className={cx(
          treeRowButton,
          rowHoverControl,
          "cursor-grab select-none",
          handleClassName ?? "text-[color:var(--editor-color-text-secondary)] hover:text-[color:var(--editor-color-text-strong)] focus-visible:ring-[var(--editor-color-focus)]",
        )}
      >
        <GripVertical size={14} strokeWidth={1.8} />
      </span>}
      {trailing}
    </>
  );
  if (nested !== undefined) {
    return (
      <div ref={setNodeRef} style={style} role={role} aria-level={ariaLevel}>
        <div className={rowClassName} data-selected={selected || undefined}>{row}</div>
        {nested}
      </div>
    );
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      role={role}
      aria-level={ariaLevel}
      className={rowClassName}
      data-selected={selected || undefined}
    >
      {row}
    </div>
  );
}
