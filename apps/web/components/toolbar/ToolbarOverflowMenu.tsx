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
  activeLocale: string;
  localeOptions: readonly { value: string; label: string }[];
  onToggleInspector: () => void;
  onOpenLocales: () => void;
  onLocaleChange: (locale: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function ToolbarOverflowMenu({
  density,
  open,
  onOpenChange,
  triggerRef,
  inspectorOpen,
  activeLocale,
  localeOptions,
  onToggleInspector,
  onOpenLocales,
  onLocaleChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
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
        className={`flex ${density === "minimal" ? "h-7 w-7" : "h-8 w-8"} items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50`}
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
        className="absolute right-0 z-40 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-950/10"
        onKeyDown={(event) => {
          handleMenuKeyboardNavigation(event, TOOLBAR_OVERFLOW_MENU_ITEM_SELECTOR);
        }}
      >
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={inspectorOpen}
          className="flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50"
          onClick={() => select(onToggleInspector)}
        >
          {inspectorOpen ? "Hide Inspector" : "Show Inspector"}
        </button>
        <button
          type="button"
          role="menuitem"
          className="flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50"
          onClick={() => select(onOpenLocales)}
        >
          Manage locales
        </button>
        {density === "minimal" ? (
          <>
            <button
              type="button"
              role="menuitem"
              aria-disabled={!canUndo}
              className={`flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50 ${canUndo ? "text-slate-700 hover:bg-slate-50 hover:text-slate-950" : "text-slate-400"}`}
              onClick={() => {
                if (canUndo) select(onUndo);
              }}
            >
              Undo
            </button>
            <button
              type="button"
              role="menuitem"
              aria-disabled={!canRedo}
              className={`flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50 ${canRedo ? "text-slate-700 hover:bg-slate-50 hover:text-slate-950" : "text-slate-400"}`}
              onClick={() => {
                if (canRedo) select(onRedo);
              }}
            >
              Redo
            </button>
          </>
        ) : null}
        {density !== "overflow-secondary"
          ? localeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === activeLocale}
              className="flex min-h-9 w-full items-center rounded-md px-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/50"
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
