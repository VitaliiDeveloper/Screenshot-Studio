// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef } from "react";
import type { OutputFamilyRow } from "../lib/editor-workspace";
import { cx, editorUi } from "./editor-ui";

/** Compact navigation between independent store-output screen sets. */
export function OutputFamilySwitcher({
  locale,
  rows,
  activeKey,
  onSelect,
}: {
  locale: string;
  rows: readonly OutputFamilyRow[];
  activeKey: string;
  onSelect: (screenId: string) => void;
}) {
  const railRef = useRef<HTMLElement>(null);
  const activeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const rail = railRef.current;
    const button = activeButtonRef.current;
    if (!rail || !button) return;
    const railRect = rail.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    if (buttonRect.left < railRect.left) {
      rail.scrollLeft -= railRect.left - buttonRect.left;
    } else if (buttonRect.right > railRect.right) {
      rail.scrollLeft += buttonRect.right - railRect.right;
    }
  }, [activeKey]);

  return (
    <nav
      ref={railRef}
      aria-label={`Output families for ${locale}`}
      className="flex gap-1 overflow-x-auto overscroll-x-contain border-y border-slate-100 bg-slate-50/80 px-2 py-1.5 [scrollbar-width:thin]"
    >
      {rows.map((row) => {
        const active = row.key === activeKey;
        return (
          <button
            key={row.key}
            ref={active ? activeButtonRef : undefined}
            type="button"
            aria-label={`${row.label} · ${row.screens.length}`}
            aria-pressed={active}
            className={cx(
              editorUi.buttonGhost,
              "min-h-7 shrink-0 rounded-md border px-2 text-[10px]",
              active
                ? "border-blue-200 bg-white text-blue-700 shadow-sm hover:bg-white"
                : "border-transparent text-slate-500",
            )}
            onClick={() => onSelect(row.screens[0]!.id)}
          >
            <span>{row.label}</span>
            <span aria-hidden="true" className="text-slate-400">·</span>
            <span>{row.screens.length}</span>
          </button>
        );
      })}
    </nav>
  );
}
