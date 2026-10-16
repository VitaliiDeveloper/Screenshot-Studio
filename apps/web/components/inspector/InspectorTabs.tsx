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
  layerEmpty,
  onSelect,
}: {
  tab: InspectorTab;
  idPrefix: string;
  /** Nothing is selected, so the Layer tab can only show a hint. */
  layerEmpty: boolean;
  onSelect: (tab: InspectorTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Inspector sections"
      // Text size sits here: the global `button { font: inherit }` reset outranks utilities on buttons.
      className="relative flex px-3 text-xs"
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
        const empty = value === "layer" && layerEmpty;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            id={inspectorTabId(idPrefix, value)}
            aria-selected={selected}
            aria-controls={inspectorPanelId(idPrefix)}
            tabIndex={selected ? 0 : -1}
            title={empty ? "Select a layer to edit it" : undefined}
            className={cx(
              "w-16 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/70",
              empty ? "text-slate-400 hover:text-slate-600"
                : selected ? "text-slate-950" : "text-slate-500 hover:text-slate-800",
            )}
            onClick={() => onSelect(value)}
          >
            {label}
          </button>
        );
      })}
      {/* Equal-width tabs let the indicator slide by its own width, with no measuring. */}
      <span
        aria-hidden="true"
        className="absolute -bottom-px left-3 h-0.5 w-16 rounded-full bg-blue-600 transition-transform duration-200 ease-[var(--editor-motion-ease)] motion-reduce:transition-none"
        style={{ transform: `translateX(${TABS.findIndex(({ value }) => value === tab) * 100}%)` }}
      />
    </div>
  );
}
