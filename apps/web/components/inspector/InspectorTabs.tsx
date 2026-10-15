// SPDX-License-Identifier: Apache-2.0
"use client";

import { cx } from "@web/components/editor-ui";
import type { InspectorTab } from "./inspector-tab-model";

const TABS: ReadonlyArray<{ value: InspectorTab; label: string }> = [
  { value: "layer", label: "Layer" },
  { value: "screen", label: "Screen" },
];

export function inspectorTabId(idPrefix: string, tab: InspectorTab): string {
  return `${idPrefix}-tab-${tab}`;
}

export function inspectorPanelId(idPrefix: string): string {
  return `${idPrefix}-panel`;
}

/** Layer / Screen tabs; arrow keys, Home, and End move between tabs and activate them. */
export function InspectorTabs({
  tab,
  idPrefix,
  onSelect,
}: {
  tab: InspectorTab;
  idPrefix: string;
  onSelect: (tab: InspectorTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Inspector sections"
      className="flex gap-1 border-b border-slate-200 px-3"
      onKeyDown={(event) => {
        const index = TABS.findIndex(({ value }) => value === tab);
        const nextIndex = event.key === "ArrowRight" ? (index + 1) % TABS.length
          : event.key === "ArrowLeft" ? (index - 1 + TABS.length) % TABS.length
            : event.key === "Home" ? 0
              : event.key === "End" ? TABS.length - 1
                : null;
        if (nextIndex === null) return;
        event.preventDefault();
        const next = TABS[nextIndex]!.value;
        onSelect(next);
        document.getElementById(inspectorTabId(idPrefix, next))?.focus();
      }}
    >
      {TABS.map(({ value, label }) => {
        const selected = value === tab;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            id={inspectorTabId(idPrefix, value)}
            aria-selected={selected}
            aria-controls={inspectorPanelId(idPrefix)}
            tabIndex={selected ? 0 : -1}
            className={cx(
              "-mb-px border-b-2 px-2 py-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70",
              selected
                ? "border-blue-600 font-semibold text-slate-950"
                : "border-transparent text-slate-500 hover:text-slate-800",
            )}
            onClick={() => onSelect(value)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
