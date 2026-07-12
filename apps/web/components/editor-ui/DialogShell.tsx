// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx, editorUi } from "./styles.js";

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
