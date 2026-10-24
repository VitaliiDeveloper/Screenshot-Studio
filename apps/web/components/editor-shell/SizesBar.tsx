// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import { useStore } from "zustand";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { AddMenu, ConfirmationDialog, cx, editorUi } from "@web/components/editor-ui";
import { sizesBarModel, type AddSizeAction, type SizeRemoval } from "@web/components/sizes-bar-model";
import { editorStore, selectEditorLayout } from "@web/lib/editor/editor-store";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";

function addSize(action: AddSizeAction): void {
  if (action.kind === "family") {
    mutateAndSave(() => editorStore.getState().ensureStoreOutputFamily(action.platform, action.device, action.leadTarget));
    return;
  }
  // The variant mutation attaches to the active screen's family, so open that family first.
  if (action.openScreenId) editorStore.getState().selectScreen(action.openScreenId);
  mutateAndSave(() => editorStore.getState().ensureStoreTargetVariant(action.target));
}

function removeSize(removal: SizeRemoval): void {
  mutateAndSave(() => (removal.kind === "size"
    ? editorStore.getState().removeStoreTargetVariant(removal.rootScreenId, removal.targetId)
    : editorStore.getState().removeStoreOutputFamily(removal.sourceScreenId)));
}

/**
 * The layout's exact sizes for the active locale: switch, add, and remove them. While an agent run
 * holds the project only switching stays live, like the `[` and `]` view keys.
 */
export function SizesBar({ specs, locked = false }: { specs: StoreSpecs; locked?: boolean }) {
  const layout = useStore(editorStore, selectEditorLayout);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const [pendingRemoval, setPendingRemoval] = useState<SizeRemoval | null>(null);
  const screen = layout?.screens.find(({ id }) => id === activeScreenId);
  if (!layout || !screen) return null;
  const { groups, current, addOptions } = sizesBarModel(layout, screen, specs);
  const removal = current?.removal ?? null;

  return (
    <section
      aria-label="Sizes"
      data-testid="sizes-bar"
      className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] px-3.5 text-xs"
    >
      <span className={cx(editorUi.sectionLabel, "shrink-0")}>Sizes</span>
      <div className="flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        {groups.map((group, index) => (
          <div key={group.key} role="group" aria-label={`${group.label} sizes`} className="flex shrink-0 items-center gap-2">
            {index > 0 ? <span aria-hidden="true" className="mx-1 h-5 w-px bg-[var(--editor-color-border)]" /> : null}
            <span className="text-[11px] text-[color:var(--editor-color-text-muted)]">{group.label}</span>
            {group.chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                aria-label={[chip.label, chip.pixels, chip.role === "master" ? "Master" : "Variant"].filter(Boolean).join(" ")}
                aria-current={chip.current ? "true" : undefined}
                title={[chip.devices, chip.pixels ?? undefined].filter(Boolean).join(" · ") || undefined}
                className={cx(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--editor-radius-control)] border px-2 transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-[var(--editor-color-focus)]",
                  chip.current
                    ? "border-[var(--editor-color-accent)] bg-[var(--editor-color-accent-subtle)] font-semibold text-[color:var(--editor-color-accent)]"
                    : "border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] text-[color:var(--editor-color-text-muted)] hover:border-[var(--editor-color-accent-muted)]",
                )}
                onClick={() => editorStore.getState().selectScreen(chip.screenId)}
              >
                <span>{chip.label}</span>
                {chip.pixels ? <span className="font-mono text-[10px] font-normal text-[color:var(--editor-color-text-muted)]">{chip.pixels}</span> : null}
                <span
                  data-size-role={chip.role}
                  className={chip.role === "master"
                    ? "rounded bg-[var(--editor-color-text-strong)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--editor-color-on-accent)]"
                    : "rounded border border-[var(--editor-color-border-strong)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[color:var(--editor-color-text-muted)]"}
                >
                  {chip.role === "master" ? "Master" : "Variant"}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="shrink-0">
        <AddMenu
          ariaLabel="Add size"
          triggerLabel="Add size"
          menuLabel="Available sizes"
          menuClassName="menu-select-surface left-0"
          options={locked ? [] : addOptions}
          onSelect={(value) => {
            const option = addOptions.find((candidate) => candidate.value === value);
            if (option) addSize(option.action);
          }}
        />
      </div>
      <div className="flex-1" />
      <button
        type="button"
        className={cx(editorUi.buttonGhost, "shrink-0")}
        disabled={locked || !removal}
        onClick={() => setPendingRemoval(removal)}
      >
        Remove size…
      </button>
      {pendingRemoval && !locked ? (
        <ConfirmationDialog
          title={pendingRemoval.kind === "size" ? "Remove output size?" : "Remove output target?"}
          description={pendingRemoval.kind === "family"
            ? `Remove ${pendingRemoval.label} and all of its screen sizes from this locale?`
            : pendingRemoval.synchronized
              ? `Remove ${pendingRemoval.label} from every synchronized screen slot? The primary output stays unchanged.`
              : `Remove ${pendingRemoval.label}? The primary output stays unchanged.`}
          confirmLabel="Remove output"
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => {
            const confirmed = pendingRemoval;
            setPendingRemoval(null);
            removeSize(confirmed);
          }}
        />
      ) : null}
    </section>
  );
}
