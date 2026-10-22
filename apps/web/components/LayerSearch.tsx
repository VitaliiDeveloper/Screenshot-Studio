// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Screen } from "@screenshot-studio/core/model";
import {
  findScreensAndLayers,
  stepActiveIndex,
  type SearchResult,
} from "@web/lib/editor/editor-search";
import { cx, editorUi } from "./editor-ui";

const LABEL = "Find screen or layer";
const secondary = "text-[color:var(--editor-color-text-secondary)]";

function SearchBox({
  screens,
  onPick,
  onClose,
}: {
  screens: readonly Screen[];
  onPick: (result: SearchResult) => void;
  onClose: (refocusTrigger: boolean) => void;
}) {
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const results = useMemo(() => findScreensAndLayers(screens, query), [screens, query]);
  const current = Math.min(activeIndex, results.length - 1);
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    // The side panel can still be inert on the commit that mounts the field.
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.getElementById(`${listId}-${current}`)?.scrollIntoView({ block: "nearest" });
  }, [current, listId]);

  const pick = (result: SearchResult | undefined) => {
    if (!result) return;
    onPick(result);
    onClose(true);
  };

  return (
    <div
      ref={boxRef}
      className="relative"
      onBlur={(event) => {
        if (!boxRef.current?.contains(event.relatedTarget as Node | null)) onClose(false);
      }}
    >
      <Search
        aria-hidden="true"
        size={13}
        strokeWidth={1.9}
        className={cx("pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2", secondary)}
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={LABEL}
        aria-expanded={results.length > 0}
        aria-controls={results.length > 0 ? listId : undefined}
        aria-activedescendant={current >= 0 ? optionId(current) : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder={LABEL}
        value={query}
        className={cx(editorUi.field, "pl-8")}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(stepActiveIndex(current, event.key === "ArrowDown" ? 1 : -1, results.length));
          } else if (event.key === "Enter") {
            event.preventDefault();
            pick(results[current]);
          } else if (event.key === "Escape") {
            // Without this the window-level Escape routing also closes the Layers panel.
            event.preventDefault();
            event.stopPropagation();
            onClose(true);
          }
        }}
      />
      {results.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Screens and layers"
          // Keeps focus in the field so a click on an option is not preceded by a blur.
          onMouseDown={(event) => event.preventDefault()}
          className="menu-select-surface absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-[var(--editor-radius-surface)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-1 shadow-[var(--editor-shadow-menu)]"
        >
          {results.map((result, index) => (
            <li
              key={`${result.screenId}:${result.elementId ?? ""}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === current}
              className={cx(
                "flex cursor-pointer flex-col gap-0.5 rounded-[var(--editor-radius-compact)] px-2 py-1.5",
                index === current
                  ? "bg-[var(--editor-color-accent-subtle)]"
                  : "hover:bg-[var(--editor-color-surface-subtle)]",
              )}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => pick(result)}
            >
              <span className="truncate text-[13px] font-medium text-[color:var(--editor-color-text-strong)]">
                {result.label}
              </span>
              <span className={cx("truncate text-[11px]", secondary)}>
                {result.detail}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p
          role="status"
          className={cx("absolute inset-x-0 top-full z-20 mt-1 rounded-[var(--editor-radius-surface)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-3 py-2 text-xs shadow-[var(--editor-shadow-menu)]", secondary)}
        >
          No screens or layers match “{query}”.
        </p>
      )}
    </div>
  );
}

/**
 * The Layers panel's search field. The trigger opens a combobox over the screens and layers the
 * panel lists; closing it with Esc or a pick returns focus to the trigger.
 */
export function LayerSearch({
  open,
  onOpenChange,
  screens,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  screens: readonly Screen[];
  onPick: (result: SearchResult) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (open) {
    return (
      <SearchBox
        screens={screens}
        onPick={onPick}
        onClose={(refocusTrigger) => {
          onOpenChange(false);
          if (refocusTrigger) requestAnimationFrame(() => triggerRef.current?.focus());
        }}
      />
    );
  }
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="listbox"
      aria-expanded={false}
      aria-keyshortcuts="Meta+K Control+K"
      className={cx(editorUi.field, "flex items-center gap-2 text-left")}
      onClick={() => onOpenChange(true)}
    >
      <Search aria-hidden="true" size={13} strokeWidth={1.9} className={cx("shrink-0", secondary)} />
      <span className={cx("min-w-0 flex-1 truncate", secondary)}>{LABEL}</span>
      <kbd aria-hidden="true" className={cx("shrink-0 font-sans text-[10px] font-medium", secondary)}>⌘K</kbd>
    </button>
  );
}
