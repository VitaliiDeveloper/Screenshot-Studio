// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  initialFocus = "first-control",
  density = "default",
  motion,
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
  initialFocus?: "first-control" | "heading";
  density?: "default" | "compact";
  motion?: "open" | "closing";
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
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
      (initialFocus === "heading" ? headingRef.current : first ?? dialogRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        const escapeFromMenu = event.target instanceof Element
          && event.target.closest("[role='menu']") !== null;
        if (escapeFromMenu || dialog.querySelector("[role='menu']")) return;
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
        (initialFocus === "heading" ? headingRef.current : dialog)?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === headingRef.current
        || !dialog.contains(active))) {
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
  }, [initialFocus]);

  const requestClose = () => {
    if (!closeDisabled) onClose();
  };

  const dialog = (
    <div
      className={cx(
        "fixed inset-0 z-50 flex items-center justify-center bg-[var(--editor-color-overlay)] p-3 backdrop-blur-[2px] sm:p-4",
        motion && "launcher-dialog-backdrop",
      )}
      data-motion={motion}
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        aria-busy={closeDisabled || undefined}
        tabIndex={-1}
        className={cx(
          "flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-[var(--editor-color-surface-translucent)] bg-[var(--editor-color-surface)] shadow-[var(--editor-shadow-dialog)]",
          widthClass,
          motion && "launcher-dialog-panel",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={cx(
          "flex items-start justify-between border-b border-[var(--editor-color-surface-muted)]",
          density === "compact" ? "gap-3 px-4 py-3" : "gap-4 px-4 py-4 sm:px-5",
        )}>
          <div className="min-w-0">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className={cx(
                "font-semibold tracking-tight text-[color:var(--editor-color-text-strong)] outline-none",
                density === "compact" ? "text-sm" : "text-base",
              )}
            >
              {title}
            </h2>
            {description ? (
              <p className={cx(
                "mt-1 text-xs text-[color:var(--editor-color-text-secondary)]",
                density === "compact" ? "leading-4" : "leading-5",
              )}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label={closeLabel ?? `Close ${title.toLowerCase()}`}
            className={density === "compact" ? editorUi.compactIconButton : editorUi.iconButton}
            disabled={closeDisabled}
            onClick={requestClose}
          >
            <X size={density === "compact" ? 14 : 16} strokeWidth={1.8} />
          </button>
        </header>
        <div className={cx(
          "overflow-y-auto",
          density === "compact" ? "p-4" : "p-4 sm:p-5",
          bodyClassName,
        )}>
          {children}
        </div>
      </div>
    </div>
  );

  // Side panels translate and clip their contents. A document-level portal keeps every modal
  // viewport-owned while retaining the same focus trap and semantic dialog implementation.
  return typeof document === "undefined" ? dialog : createPortal(dialog, document.body);
}
