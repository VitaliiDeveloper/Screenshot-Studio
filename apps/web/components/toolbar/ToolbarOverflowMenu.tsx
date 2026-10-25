// SPDX-License-Identifier: Apache-2.0
"use client";

import { MoreHorizontal } from "lucide-react";
import React, { useEffect, useId, useRef } from "react";
import type { ToolbarDensity } from "./toolbar-density";
import { handleMenuKeyboardNavigation } from "@web/components/editor-ui/menu-behavior";

export const TOOLBAR_OVERFLOW_MENU_ITEM_SELECTOR =
  "[role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio']";

type OverflowMenuOpenIntent = "pointer" | "ArrowDown" | "ArrowUp" | "Home" | "End";

export function initialOverflowMenuFocusEdge(
  intent: OverflowMenuOpenIntent,
): "first" | "last" {
  return intent === "ArrowUp" || intent === "End" ? "last" : "first";
}

export interface ToolbarOverflowMenuProps {
  density: Extract<ToolbarDensity, "overflow-secondary" | "overflow-locale" | "minimal">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  inspectorOpen: boolean;
  /** Accessible Issues summary; the Issues item appears only when it and `onOpenIssues` are set. */
  issuesLabel?: string;
  issueCount?: number;
  onOpenIssues?: () => void;
  activeLocale: string;
  localeOptions: readonly { value: string; label: string }[];
  onToggleInspector: () => void;
  onLocaleChange: (locale: string) => void;
}

export function ToolbarOverflowMenu({
  density,
  open,
  onOpenChange,
  triggerRef,
  inspectorOpen,
  issuesLabel,
  issueCount = 0,
  onOpenIssues,
  activeLocale,
  localeOptions,
  onToggleInspector,
  onLocaleChange,
}: ToolbarOverflowMenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const initialFocusEdgeRef = useRef<"first" | "last">("first");

  const closeMenu = (restoreFocus = false) => {
    onOpenChange(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;

    const focusInitialItem = requestAnimationFrame(() => {
      const items = Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>(TOOLBAR_OVERFLOW_MENU_ITEM_SELECTOR) ?? [],
      );
      const item = initialFocusEdgeRef.current === "last" ? items.at(-1) : items[0];
      item?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusInitialItem);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onOpenChange, open, triggerRef]);

  const select = (action: () => void) => {
    action();
    closeMenu(true);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="More toolbar actions"
        title="More toolbar actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={`flex ${density === "minimal" ? "h-7 w-7" : "h-8 w-8"} items-center justify-center rounded-md text-[color:var(--editor-color-text-muted)] transition-colors hover:bg-[var(--editor-color-surface-muted)] hover:text-[color:var(--editor-color-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]`}
        onClick={() => {
          if (open) {
            onOpenChange(false);
            return;
          }
          initialFocusEdgeRef.current = initialOverflowMenuFocusEdge("pointer");
          onOpenChange(true);
        }}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          initialFocusEdgeRef.current = initialOverflowMenuFocusEdge(
            event.key as Exclude<OverflowMenuOpenIntent, "pointer">,
          );
          onOpenChange(true);
        }}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>

      <div
        id={menuId}
        role="menu"
        aria-label="More toolbar actions"
        hidden={!open}
        className="absolute right-0 z-40 mt-1 w-52 overflow-hidden rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-1 shadow-xl shadow-slate-950/10"
        onKeyDown={(event) => {
          handleMenuKeyboardNavigation(event, TOOLBAR_OVERFLOW_MENU_ITEM_SELECTOR);
        }}
      >
        {issuesLabel && onOpenIssues ? (
          <button
            type="button"
            role="menuitem"
            aria-label={issuesLabel}
            className="flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-sm text-[color:var(--editor-color-text-default)] transition-colors hover:bg-[var(--editor-color-surface-subtle)] hover:text-[color:var(--editor-color-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)]"
            onClick={() => {
              // Focus the live trigger first so the dialog returns focus there, not to this hidden item.
              closeMenu();
              triggerRef.current?.focus();
              onOpenIssues();
            }}
          >
            Issues
            {issueCount > 0 ? (
              <span aria-hidden="true" className="ml-auto rounded-md bg-[var(--editor-color-surface-muted)] px-1.5 text-[11px] font-semibold tabular-nums text-[color:var(--editor-color-text-muted)]">
                {issueCount}
              </span>
            ) : null}
          </button>
        ) : null}
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={inspectorOpen}
          className="flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-sm text-[color:var(--editor-color-text-default)] transition-colors hover:bg-[var(--editor-color-surface-subtle)] hover:text-[color:var(--editor-color-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)]"
          onClick={() => select(onToggleInspector)}
        >
          {inspectorOpen ? "Hide Inspector" : "Show Inspector"}
        </button>
        {density !== "overflow-secondary"
          ? localeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === activeLocale}
              className="flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-sm text-[color:var(--editor-color-text-default)] transition-colors hover:bg-[var(--editor-color-surface-subtle)] hover:text-[color:var(--editor-color-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)]"
              onClick={() => select(() => onLocaleChange(option.value))}
            >
              {option.label}
            </button>
          ))
          : null}
      </div>
    </div>
  );
}
