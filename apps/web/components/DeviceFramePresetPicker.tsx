// SPDX-License-Identifier: Apache-2.0
"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import {
  DEVICE_FRAME_PRESETS,
  deviceFramePreset,
  type DeviceFrameId,
  type DeviceFramePreset,
  type Screen,
} from "@screenshot-studio/core/model";
import { deviceFrameContextForScreen } from "@web/lib/editor/editor-workspace";
import { DialogShell, editorUi } from "./editor-ui";
import { DeviceFramePresetThumbnail } from "./DeviceFramePresetThumbnail";

type DeviceFrameScreenContext = Pick<Screen, "platform" | "device" | "artboard">;

type DeviceFramePickerGroupLabel =
  | "Phone" | "Tablet" | "Browser" | "Computer" | "TV" | "Watch" | "Special" | "Legacy";

interface DeviceFramePickerGroupRule {
  readonly label: DeviceFramePickerGroupLabel;
  readonly includes: (preset: DeviceFramePreset) => boolean;
  readonly compare?: (left: DeviceFramePreset, right: DeviceFramePreset) => number;
}

const deviceFramePickerGroupRules: readonly DeviceFramePickerGroupRule[] = [
  { label: "Phone", includes: ({ group, legacy }) => group === "phone" && !legacy },
  { label: "Tablet", includes: ({ group, legacy }) => group === "tablet" && !legacy },
  { label: "Browser", includes: ({ group, legacy }) => group === "browser" && !legacy },
  {
    label: "Computer",
    includes: ({ group, tags, legacy }) => !legacy && (
      group === "desktop" || (group === "display" && tags.includes("desktop"))
    ),
  },
  {
    label: "TV",
    includes: ({ group, tags, legacy }) => !legacy && group === "display" && tags.includes("television"),
    compare: (left, right) => Number(left.tags.includes("minimal")) - Number(right.tags.includes("minimal")),
  },
  { label: "Watch", includes: ({ group, legacy }) => group === "wearable" && !legacy },
  {
    label: "Special",
    includes: ({ group, legacy }) => !legacy && (
      group === "foldable" || group === "automotive" || group === "spatial"
    ),
  },
  { label: "Legacy", includes: ({ legacy }) => legacy },
];

export const deviceFramePickerGroups: readonly {
  label: DeviceFramePickerGroupLabel;
  presetIds: readonly DeviceFrameId[];
}[] = deviceFramePickerGroupRules.map(({ label, includes, compare }) => ({
  label,
  presetIds: DEVICE_FRAME_PRESETS
    .filter(includes)
    .sort(compare)
    .map(({ id }) => id),
}));

export interface DeviceFramePresetOccurrence {
  readonly occurrenceKey: string;
  readonly groupLabel: (typeof deviceFramePickerGroups)[number]["label"];
  readonly preset: DeviceFramePreset;
}

export function nextDeviceFrameCardIndex(
  key: string,
  currentIndex: number,
  count: number,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (currentIndex + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (currentIndex - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

function matchesFrameSearch(preset: DeviceFramePreset, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return preset.label.toLocaleLowerCase().includes(needle)
    || preset.tags.some((tag) => tag.includes(needle));
}

export function groupedVisibleDeviceFramePresetOccurrences(
  query: string,
): readonly DeviceFramePresetOccurrence[] {
  return deviceFramePickerGroups.flatMap(({ label, presetIds }) => presetIds
    .map((id) => deviceFramePreset(id))
    .filter((preset) => matchesFrameSearch(preset, query))
    .map((preset) => ({
      occurrenceKey: `${label}:${preset.id}`,
      groupLabel: label,
      preset,
    })));
}

export function DeviceFramePresetCatalog({
  query,
  selectedId,
  screen,
  onSelect,
}: {
  query: string;
  selectedId: DeviceFrameId;
  screen?: DeviceFrameScreenContext | null;
  onSelect: (id: DeviceFrameId) => void;
}) {
  const occurrences = useMemo(() => groupedVisibleDeviceFramePresetOccurrences(query), [query]);
  const context = deviceFrameContextForScreen(screen);
  const [focusedOccurrenceKey, setFocusedOccurrenceKey] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());
  const effectiveFocusedOccurrenceKey = occurrences.some(
    ({ occurrenceKey }) => occurrenceKey === focusedOccurrenceKey,
  )
    ? focusedOccurrenceKey
    : (occurrences.find(({ preset }) => preset.id === selectedId)?.occurrenceKey
      ?? occurrences[0]?.occurrenceKey);

  if (occurrences.length === 0) {
    return (
      <p role="status" className="grid min-h-40 place-items-center text-center text-xs text-[color:var(--editor-color-text-secondary)]">
        No frames match “{query}”. Try a device type, style, or finish.
      </p>
    );
  }

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, occurrenceKey: string) => {
    const currentIndex = occurrences.findIndex((occurrence) =>
      occurrence.occurrenceKey === occurrenceKey);
    const nextIndex = nextDeviceFrameCardIndex(event.key, currentIndex, occurrences.length);
    if (nextIndex === null) return;
    event.preventDefault();
    const nextOccurrenceKey = occurrences[nextIndex]!.occurrenceKey;
    setFocusedOccurrenceKey(nextOccurrenceKey);
    cardRefs.current.get(nextOccurrenceKey)?.focus();
  };

  return (
    <div className="space-y-5">
      {deviceFramePickerGroups.map((group) => {
        const groupOccurrences = occurrences.filter(({ groupLabel }) => groupLabel === group.label);
        if (groupOccurrences.length === 0) return null;
        return (
          <section key={group.label} aria-labelledby={`frame-group-${group.label.toLocaleLowerCase()}`}>
            <h3
              id={`frame-group-${group.label.toLocaleLowerCase()}`}
              className={`mb-2 ${editorUi.sectionLabel}`}
            >
              {group.label}
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {groupOccurrences.map(({ occurrenceKey, preset }) => {
                const recommended = preset.id === context.recommendedPresetId;
                const unsuitable = context.unsuitablePresetIds.includes(preset.id);
                return (
                  <button
                    key={occurrenceKey}
                    ref={(node) => {
                      if (node) cardRefs.current.set(occurrenceKey, node);
                      else cardRefs.current.delete(occurrenceKey);
                    }}
                    type="button"
                    aria-label={`${preset.label}${recommended ? ", Recommended" : ""}${unsuitable ? ", Not suitable for Google Play submission" : ""}`}
                    aria-pressed={preset.id === selectedId}
                    tabIndex={occurrenceKey === effectiveFocusedOccurrenceKey ? 0 : -1}
                    className="rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-2 text-left shadow-sm transition hover:border-[var(--editor-color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] aria-pressed:border-[var(--editor-color-accent)] aria-pressed:ring-1 aria-pressed:ring-[var(--editor-color-accent)]"
                    onFocus={() => setFocusedOccurrenceKey(occurrenceKey)}
                    onKeyDown={(event) => moveFocus(event, occurrenceKey)}
                    onClick={() => onSelect(preset.id)}
                  >
                    <DeviceFramePresetThumbnail preset={preset} />
                    <span className="mt-2 block text-xs font-semibold text-[color:var(--editor-color-text-strong)]">
                      {preset.label}
                    </span>
                    {recommended ? (
                      <span className="mt-1 block text-[10px] font-medium text-[color:var(--editor-color-accent)]">Recommended</span>
                    ) : null}
                    {unsuitable ? (
                      <span className="mt-1 block text-[10px] leading-4 text-amber-700">
                        Not suitable for Google Play submission
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function DeviceFramePresetPicker({
  selectedId,
  screen,
  onSelect,
  onClose,
}: {
  selectedId: DeviceFrameId;
  screen?: DeviceFrameScreenContext | null;
  onSelect: (id: DeviceFrameId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <DialogShell
      title="Choose frame"
      description="Choose a built-in frame style. Your screenshot and placement stay unchanged."
      ariaLabel="Device frame picker"
      closeLabel="Close frame picker"
      onClose={onClose}
      widthClass="max-w-4xl"
      bodyClassName="min-h-0"
    >
      <label className="relative mb-4 block">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--editor-color-text-muted)]"
          size={15}
          strokeWidth={1.9}
        />
        <input
          type="search"
          aria-label="Search frames"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search frames…"
          className={`${editorUi.field} pl-9`}
        />
      </label>
      <DeviceFramePresetCatalog
        query={query}
        selectedId={selectedId}
        screen={screen}
        onSelect={(id) => {
          onSelect(id);
          onClose();
        }}
      />
    </DialogShell>
  );
}
