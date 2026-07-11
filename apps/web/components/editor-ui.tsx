// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, FolderOpen, Plus, X, type LucideIcon } from "lucide-react";

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-2";

export const editorUi = {
  buttonBase: `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 ${focusRing}`,
  buttonSecondary: `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-45 ${focusRing}`,
  buttonPrimary: `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-45 ${focusRing}`,
  buttonGhost: `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-45 ${focusRing}`,
  buttonDanger: `inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:pointer-events-none disabled:opacity-45 ${focusRing}`,
  iconButton: `inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-35 ${focusRing}`,
  compactAddButton: `inline-flex size-6 shrink-0 items-center justify-center rounded-md text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:pointer-events-none disabled:opacity-35 ${focusRing}`,
  field: `h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/15`,
  textarea: `w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 shadow-sm transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/15`,
};

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

export type MenuSelectOption<T extends string> = {
  value: T;
  label: string;
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
  showSelectedIcon = false,
}: {
  ariaLabel: string;
  menuLabel?: string;
  value: T;
  options: readonly MenuSelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  showSelectedIcon?: boolean;
}) {
  const menuId = useId();
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const activeOption = options.find((option) => option.value === value) ?? options[0];
  const ActiveIcon = activeOption?.icon;

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) {
        const estimatedMenuHeight = options.length * 36 + 12;
        setOpenUpward(window.innerHeight - rect.bottom < estimatedMenuHeight && rect.top > window.innerHeight - rect.bottom);
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
          "group flex h-8 w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 shadow-sm transition-all",
          "hover:border-slate-300 hover:text-slate-900 hover:shadow-md",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-2",
          open && "border-blue-200 text-slate-900 shadow-md ring-2 ring-blue-500/10",
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
          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors group-hover:bg-slate-200/70 group-hover:text-slate-700">
            <ActiveIcon size={14} strokeWidth={1.8} />
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-left">{activeOption.label}</span>
        <ChevronDown size={14} strokeWidth={1.9} className={cx("shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          className={cx(
            "absolute right-0 z-40 min-w-full rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-950/12",
            openUpward ? "bottom-full mb-1" : "top-full mt-1",
            menuClassName,
          )}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']"));
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
                  "flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60",
                  selected ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
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
                    selected ? "bg-white text-blue-600 shadow-sm ring-1 ring-blue-100" : "text-slate-400",
                  )}>
                    <OptionIcon size={14} strokeWidth={1.8} />
                  </span>
                ) : null}
                <span className="flex-1 truncate">{option.label}</span>
                <Check size={14} strokeWidth={2.2} className={cx("text-blue-600", selected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function DialogShell({
  title,
  description,
  onClose,
  children,
  widthClass = "max-w-xl",
  bodyClassName,
  ariaLabel,
  closeLabel,
  closeDisabled = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  widthClass?: string;
  bodyClassName?: string;
  ariaLabel?: string;
  closeLabel?: string;
  closeDisabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { closeDisabledRef.current = closeDisabled; }, [closeDisabled]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
      );
      (first ?? dialogRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!closeDisabledRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
      )).filter((element) => element.tabIndex >= 0 && !element.hasAttribute("hidden"));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const requestClose = () => {
    if (!closeDisabled) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-[2px] sm:p-4" onClick={requestClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        aria-busy={closeDisabled || undefined}
        tabIndex={-1}
        className={cx(
          "flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl shadow-slate-950/25",
          widthClass,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-slate-950">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}
          </div>
          <button
            type="button"
            aria-label={closeLabel ?? `Close ${title.toLowerCase()}`}
            className={editorUi.iconButton}
            disabled={closeDisabled}
            onClick={requestClose}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </header>
        <div className={cx("overflow-y-auto p-4 sm:p-5", bodyClassName)}>{children}</div>
      </div>
    </div>
  );
}

export function EmptyResourceState({
  title,
  description,
  path,
  icon: Icon = FolderOpen,
}: {
  title: string;
  description: string;
  path: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-8 text-center">
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
        <Icon size={18} strokeWidth={1.7} />
      </span>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{description}</p>
      <code className="mt-3 rounded-md bg-slate-200/70 px-2 py-1 text-[11px] text-slate-600">{path}</code>
    </div>
  );
}
