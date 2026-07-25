// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { handleMenuKeyboardNavigation, shouldOpenMenuUpward } from "./menu-behavior.js";
import { cx } from "./styles.js";

export type MenuSelectOption<T extends string> = {
  value: T;
  label: string;
  triggerLabel?: string;
  icon?: LucideIcon;
};

/** Shared value picker for editor controls. Keeps the visual language and keyboard behavior consistent. */
export function MenuSelect<T extends string>({
  ariaLabel,
  menuLabel = `${ariaLabel} options`,
  value,
  options,
  onChange,
  className,
  triggerClassName,
  menuClassName,
  fontSize,
  showSelectedIcon = false,
  density = "default",
  appearance = "field",
}: {
  ariaLabel: string;
  menuLabel?: string;
  value: T;
  options: readonly MenuSelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  fontSize?: CSSProperties["fontSize"];
  showSelectedIcon?: boolean;
  density?: "default" | "compact";
  appearance?: "field" | "breadcrumb";
}) {
  const menuId = useId();
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const activeOption = options.find((option) => option.value === value) ?? options[0];
  const ActiveIcon = activeOption?.icon;
  const compact = density === "compact";
  const breadcrumb = appearance === "breadcrumb";

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      const menuRect = menuRef.current?.getBoundingClientRect();
      if (triggerRect && menuRect) {
        setOpenUpward(shouldOpenMenuUpward({
          triggerTop: triggerRect.top,
          triggerBottom: triggerRect.bottom,
          menuHeight: menuRect.height,
          viewportHeight: window.innerHeight,
        }));
      }
      Array.from(controlRef.current?.querySelectorAll<HTMLButtonElement>("[data-menu-select-value]") ?? [])
        .find((option) => option.dataset.menuSelectValue === value)
        ?.focus();
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
  }, [open, options.length, value]);

  if (!activeOption) return null;

  return (
    <div
      ref={controlRef}
      className={cx("relative", className)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={cx(
          "group flex w-full items-center gap-2 transition-all",
          breadcrumb
            ? "rounded-md border-0 bg-transparent text-slate-500 shadow-none hover:text-slate-600"
            : "rounded-lg border border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:text-slate-900 hover:shadow-md",
          compact
            ? breadcrumb
              ? "min-h-7 px-1 py-1 font-normal"
              : "h-7 px-2 text-[10px] font-normal text-slate-500"
            : "h-8 px-2.5 text-xs text-slate-800",
          breadcrumb
            ? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50"
            : "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-2",
          open && (breadcrumb
            ? "bg-transparent text-slate-600 shadow-none"
            : "border-blue-200 text-slate-900 shadow-md ring-2 ring-blue-500/10"),
          triggerClassName,
        )}
        style={fontSize === undefined ? undefined : { fontSize }}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        {showSelectedIcon && ActiveIcon ? (
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors group-hover:bg-slate-200/70 group-hover:text-slate-700">
            <ActiveIcon size={14} strokeWidth={1.8} />
          </span>
        ) : null}
        <span className={cx(
          "min-w-0 flex-1 truncate text-left",
          breadcrumb && "text-[11px] font-normal leading-4 text-slate-500",
        )}>
          {activeOption.triggerLabel ?? activeOption.label}
        </span>
        <ChevronDown size={14} strokeWidth={1.9} className={cx("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          data-placement={openUpward ? "top" : "bottom"}
          className={cx(
            "menu-select-surface absolute right-0 z-40 min-w-full rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-950/12",
            compact
              ? breadcrumb
                ? "flex flex-col border-slate-200/80 bg-white/95 p-1.5 shadow-slate-950/10"
                : "p-1"
              : "p-1.5",
            openUpward ? "bottom-full mb-2" : "top-full mt-2",
            menuClassName,
          )}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              requestAnimationFrame(() => triggerRef.current?.focus());
              return;
            }
            handleMenuKeyboardNavigation(event, "[role='menuitemradio']");
          }}
        >
          {options.map((option) => {
            const selected = option.value === value;
            const OptionIcon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                data-menu-select-value={option.value}
                className={cx(
                  "flex w-full items-center gap-2 text-left transition-colors",
                  compact
                    ? breadcrumb
                      ? "min-h-11 border-b border-slate-100 px-2.5 py-1.5 text-[11px] font-normal leading-4 last:border-b-0"
                      : "h-8 rounded-none border-b border-slate-100 px-2 text-[11px] font-normal last:border-b-0"
                    : "h-9 rounded-lg px-2 text-xs font-medium",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60",
                  selected
                    ? breadcrumb
                      ? "bg-blue-50/70 text-blue-600"
                      : "bg-blue-50 text-blue-700"
                    : breadcrumb
                      ? "text-slate-500 hover:bg-slate-50/90 hover:text-slate-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
                style={fontSize === undefined ? undefined : { fontSize }}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  requestAnimationFrame(() => triggerRef.current?.focus());
                }}
              >
                {OptionIcon ? (
                  <span className={cx(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                    selected ? "bg-white text-blue-600 shadow-sm ring-1 ring-blue-100" : "text-slate-400",
                  )}>
                    <OptionIcon size={14} strokeWidth={1.8} />
                  </span>
                ) : null}
                <span className={cx(
                  "flex-1 truncate",
                  breadcrumb && "text-[11px] font-normal leading-4",
                )}>
                  {option.label}
                </span>
                <Check size={14} strokeWidth={2.2} className={cx("text-blue-600", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
