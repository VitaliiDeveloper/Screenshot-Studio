// SPDX-License-Identifier: Apache-2.0
"use client";

import type { StoreSpecs } from "@screenshot-studio/core/export";
import type { DesignLayout, Screen } from "@screenshot-studio/core/model";
import { editorUi, MenuSelect, SegmentedControl } from "@web/components/editor-ui";
import { applyScopeScreens, type ApplyScope } from "@web/lib/editor/editor-apply-scope";
import { screenTargetLabel } from "@web/lib/editor/editor-issues";
import { outputFamilyEditorLabel } from "@web/lib/editor/editor-workspace";

interface ApplyScopeProps {
  layout: DesignLayout;
  screen: Screen;
  specs: StoreSpecs | null;
  value: ApplyScope;
  onChange: (scope: ApplyScope) => void;
}

/** `Only 6.9"` / `All iPhone` / `All destinations`, named from the screen being edited. */
export function applyScopeOptions(screen: Screen, specs: StoreSpecs | null) {
  const size = specs ? screenTargetLabel(screen, specs)?.split(" · ")[0] : null;
  return [
    { value: "screen", label: size ? `Only ${size}` : "Only this size" },
    { value: "family", label: `All ${outputFamilyEditorLabel(screen.platform, screen.device, specs ?? undefined)}` },
    { value: "destinations", label: "All destinations" },
  ] as const satisfies readonly { value: ApplyScope; label: string }[];
}

/** The scope picker beside a field (text size, Handoff 6a); it shares the footer's scope. */
export function ApplyScopeSelect({ screen, specs, value, onChange }: Omit<ApplyScopeProps, "layout">) {
  return (
    <MenuSelect
      ariaLabel="Apply to"
      value={value}
      options={applyScopeOptions(screen, specs)}
      onChange={onChange}
      density="compact"
      className="w-32 shrink-0"
    />
  );
}

/** Inspector footer: which exact-size screens the next edit writes to (Handoff 6a, 6c). */
export function ApplyScopeFooter({ layout, screen, specs, value, onChange }: ApplyScopeProps) {
  const count = applyScopeScreens(layout, screen, value).length;
  return (
    <footer className="sticky bottom-0 z-10 mt-auto flex flex-col gap-2 border-t border-[var(--editor-color-border)] bg-white px-4 py-3">
      <span className={editorUi.sectionLabel}>Apply to</span>
      <SegmentedControl
        label="Apply to"
        value={value}
        options={applyScopeOptions(screen, specs)}
        fill
        compact
        className="flex-wrap [&_button]:min-w-fit"
        onChange={onChange}
      />
      <p className="text-[11px] leading-4 text-[color:var(--editor-color-text-secondary)]">
        {count === 1
          ? "Edits change this screen only."
          : `One edit across ${count} exact-size screens in ${screen.locale.toUpperCase()}, one undo step.`}
      </p>
    </footer>
  );
}
