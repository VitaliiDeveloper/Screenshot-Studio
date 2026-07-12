// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { cx, editorUi } from "./styles.js";

export type AddMenuOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

/** Shared compact add menu for section-level creation actions. */
export function AddMenu<T extends string>({
  ariaLabel,
  menuLabel = `${ariaLabel} options`,
  options,
  onSelect,
  menuClassName,
}: {
  ariaLabel: string;
  menuLabel?: string;
  options: readonly AddMenuOption<T>[];
  onSelect: (value: T) => void;
  menuClassName?: string;
}) {
  const menuId = useId();
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const estimatedMenuHeight = options.length * 44 + 10;
        setOpenUpward(window.innerHeight - rect.bottom < estimatedMenuHeight && rect.top > window.innerHeight - rect.bottom);
      }
      controlRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, options.length]);

  return (
    <div
      ref={controlRef}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={options.length === 0}
        className={editorUi.compactAddButton}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Plus size={14} strokeWidth={2} aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          className={cx(
            "absolute right-0 z-40 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-950/10",
            openUpward ? "bottom-full mb-1" : "top-full mt-1",
            menuClassName,
          )}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']"));
            if (items.length === 0) return;
            event.preventDefault();
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : event.key === "ArrowDown"
                  ? (current + 1 + items.length) % items.length
                  : (current - 1 + items.length) % items.length;
            items[next]?.focus();
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitem"
              aria-label={option.label}
              className="flex min-h-11 w-full flex-col justify-center border-b border-slate-100 px-2.5 py-1.5 text-left font-normal leading-4 text-slate-600 transition-colors last:border-b-0 hover:bg-slate-50/80 hover:text-slate-800 focus-visible:relative focus-visible:z-10 focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50"
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }}
            >
              <span className="truncate text-[11px] font-normal leading-4">{option.label}</span>
              {option.description ? <span className="truncate text-[10px] font-normal leading-4 text-slate-400">{option.description}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
