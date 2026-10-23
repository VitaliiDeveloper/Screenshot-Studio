// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { handleMenuKeyboardNavigation, shouldOpenMenuUpward } from "./menu-behavior.js";
import { cx, editorUi } from "./styles.js";
import { WrapAtSeparators } from "./WrapAtSeparators.js";

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
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);

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
        <Plus
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          className={cx(
            "transition-transform duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)]",
            open && "rotate-45",
          )}
        />
      </button>

      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          data-placement={openUpward ? "top" : "bottom"}
          className={cx(
            "absolute right-0 z-40 max-h-[min(24rem,calc(100dvh-6rem))] w-56 overflow-y-auto rounded-[var(--editor-radius-surface)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-1 shadow-[var(--editor-shadow-menu)]",
            openUpward ? "bottom-full mb-1" : "top-full mt-1",
            menuClassName,
          )}
          onKeyDown={(event) => {
            handleMenuKeyboardNavigation(event, "[role='menuitem']");
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitem"
              aria-label={option.label}
              className="flex min-h-11 w-full flex-col justify-center border-b border-[var(--editor-color-surface-muted)] px-2.5 py-1.5 text-left font-normal leading-4 text-[color:var(--editor-color-text-muted)] transition-colors last:border-b-0 hover:bg-[var(--editor-color-surface-subtle)] hover:text-[color:var(--editor-color-text-strong)] focus-visible:relative focus-visible:z-10 focus-visible:rounded-[var(--editor-radius-compact)] focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)]"
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
                requestAnimationFrame(() => triggerRef.current?.focus());
              }}
            >
              <span className="break-words text-[11px] font-normal leading-4"><WrapAtSeparators text={option.label} /></span>
              {option.description ? <span className="break-words text-[10px] font-normal leading-4 text-[color:var(--editor-color-text-subtle)]"><WrapAtSeparators text={option.description} /></span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
