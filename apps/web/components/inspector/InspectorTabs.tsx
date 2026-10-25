// SPDX-License-Identifier: Apache-2.0
"use client";

import { Layers, RectangleVertical, type LucideIcon } from "lucide-react";
import { cx } from "@web/components/editor-ui";
import type { InspectorTab } from "./inspector-tab-model";

const TABS: ReadonlyArray<{ value: InspectorTab; label: string; icon: LucideIcon }> = [
  { value: "layer", label: "Layer", icon: Layers },
  { value: "screen", label: "Screen", icon: RectangleVertical },
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
  const index = TABS.findIndex(({ value }) => value === tab);
  return (
    <div
      role="tablist"
      aria-label="Inspector sections"
      className="relative grid grid-cols-2 text-xs"
      onKeyDown={(event) => {
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
      {TABS.map(({ value, label, icon: Icon }) => {
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
              "flex items-center justify-center gap-1.5 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)]",
              selected ? "text-[color:var(--editor-color-text-strong)]"
                // Dimmed but still AA on white: the tab stays usable and only shows a hint.
                : empty ? "text-[color:var(--editor-color-text-secondary)] hover:text-[color:var(--editor-color-text-default)]"
                  : "text-[color:var(--editor-color-text-muted)] hover:text-[color:var(--editor-color-text-strong)]",
            )}
            onClick={() => onSelect(value)}
          >
            <Icon
              aria-hidden="true"
              size={14}
              strokeWidth={1.8}
              className={selected ? "text-[color:var(--editor-color-accent-text)]" : "text-[color:var(--editor-color-text-subtle)]"}
            />
            {label}
          </button>
        );
      })}
      {/* Equal halves let the indicator slide by its own width, with no measuring. */}
      <span
        aria-hidden="true"
        className="absolute -bottom-px left-0 h-0.5 w-1/2 rounded-full bg-[var(--editor-color-accent)] transition-transform duration-200 ease-[var(--editor-motion-ease)]"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
    </div>
  );
}
