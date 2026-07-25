// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useEffect, useId, useRef, useState } from "react";
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
  textSize = "default",
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
  textSize?: "default" | "emphasis";
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
  const emphasis = textSize === "emphasis";

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
            ? "rounded-md border-0 bg-transparent text-[color:var(--editor-color-text-secondary)] shadow-none hover:text-[color:var(--editor-color-text-muted)]"
            : "rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] shadow-[var(--editor-shadow-control)] hover:border-[var(--editor-color-border-strong)] hover:text-[color:var(--editor-color-text-strong)]",
          compact
            ? breadcrumb
              ? "min-h-7 px-1 py-1 font-normal"
              : "h-7 px-2 font-normal text-[color:var(--editor-color-text-secondary)]"
            : "h-8 px-2.5 text-[color:var(--editor-color-text)]",
          emphasis
            ? "text-[length:var(--editor-font-control-emphasis-size)]"
            : compact ? "text-[10px]" : "text-[length:var(--editor-font-control-size)]",
          breadcrumb
            ? "focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)]"
            : "focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-[length:var(--editor-focus-offset)]",
          open && (breadcrumb
            ? "bg-transparent text-[color:var(--editor-color-text-muted)] shadow-none"
            : "border-[var(--editor-color-focus-border)] text-[color:var(--editor-color-text-strong)] ring-[length:var(--editor-focus-width)] ring-[var(--editor-color-focus-subtle)]"),
          triggerClassName,
        )}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        {showSelectedIcon && ActiveIcon ? (
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--editor-radius-control)] bg-[var(--editor-color-surface-muted)] text-[color:var(--editor-color-text-secondary)] transition-colors group-hover:bg-[var(--editor-color-border)] group-hover:text-[color:var(--editor-color-text-default)]">
            <ActiveIcon size={14} strokeWidth={1.8} />
          </span>
        ) : null}
        <span className={cx(
          "min-w-0 flex-1 truncate text-left",
          breadcrumb && "text-[11px] font-normal leading-4 text-[color:var(--editor-color-text-secondary)]",
        )}>
          {activeOption.triggerLabel ?? activeOption.label}
        </span>
        <ChevronDown size={14} strokeWidth={1.9} className={cx("shrink-0 text-[color:var(--editor-color-text-subtle)] transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          data-placement={openUpward ? "top" : "bottom"}
          className={cx(
            "menu-select-surface absolute right-0 z-40 min-w-full rounded-[var(--editor-radius-surface)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] shadow-[var(--editor-shadow-menu)]",
            compact
              ? breadcrumb
                ? "flex flex-col border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-1.5"
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
                      ? "min-h-11 border-b border-[var(--editor-color-surface-muted)] px-2.5 py-1.5 font-normal leading-4 last:border-b-0"
                      : "h-8 rounded-none border-b border-[var(--editor-color-surface-muted)] px-2 font-normal last:border-b-0"
                    : "h-9 rounded-[var(--editor-radius-control)] px-2 font-medium",
                  emphasis
                    ? "text-[length:var(--editor-font-control-emphasis-size)]"
                    : compact ? "text-[11px]" : "text-[length:var(--editor-font-control-size)]",
                  "focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)]",
                  selected
                    ? breadcrumb
                      ? "bg-[var(--editor-color-accent-subtle)] text-[color:var(--editor-color-accent)]"
                      : "bg-[var(--editor-color-accent-subtle)] text-[color:var(--editor-color-accent-hover)]"
                    : breadcrumb
                      ? "text-[color:var(--editor-color-text-secondary)] hover:bg-[var(--editor-color-surface-subtle)] hover:text-[color:var(--editor-color-text-default)]"
                      : "text-[color:var(--editor-color-text-muted)] hover:bg-[var(--editor-color-surface-subtle)] hover:text-[color:var(--editor-color-text-strong)]",
                )}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  requestAnimationFrame(() => triggerRef.current?.focus());
                }}
              >
                {OptionIcon ? (
                  <span className={cx(
                    "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                    selected
                      ? "bg-[var(--editor-color-surface)] text-[color:var(--editor-color-accent)] shadow-[var(--editor-shadow-control)] ring-1 ring-[var(--editor-color-accent-muted)]"
                      : "text-[color:var(--editor-color-text-subtle)]",
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
                <Check size={14} strokeWidth={2.2} className={cx("text-[color:var(--editor-color-accent)]", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
