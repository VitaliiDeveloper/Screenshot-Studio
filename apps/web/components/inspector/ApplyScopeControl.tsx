// SPDX-License-Identifier: Apache-2.0
"use client";

import type { StoreSpecs } from "@screenshot-studio/core/export";
import type { DesignLayout, Element, Screen } from "@screenshot-studio/core/model";
import { editorUi, MenuSelect, SegmentedControl } from "@web/components/editor-ui";
import { applyScopeScreens, scopedElementPatches, type ApplyScope } from "@web/lib/editor/editor-apply-scope";
import { screenTargetLabel } from "@web/lib/editor/editor-issues";
import { outputFamilyEditorLabel } from "@web/lib/editor/editor-workspace";

interface ApplyScopeProps {
  layout: DesignLayout;
  screen: Screen;
  specs: StoreSpecs | null;
  value: ApplyScope;
  onChange: (scope: ApplyScope) => void;
}

/** `Only Dynamic Island · Large` / `All iPhone` / `All destinations`, named from the screen being edited. */
export function applyScopeOptions(screen: Screen, specs: StoreSpecs | null) {
  const parts = specs ? screenTargetLabel(screen, specs)?.split(" · ") : undefined;
  // The size name can itself contain ` · `, so cut at the orientation, not at the first separator.
  const orientation = parts?.findIndex((part) => /^(?:Portrait|Landscape|Square)$/.test(part)) ?? -1;
  const size = parts ? parts.slice(0, orientation > 0 ? orientation : 1).join(" · ") : null;
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
      // Size names like `Dynamic Island · Medium` overflow this trigger; the menu keeps the full name.
      options={applyScopeOptions(screen, specs).map((option) =>
        option.value === "screen" ? { ...option, triggerLabel: "This size" } : option)}
      onChange={onChange}
      density="compact"
      className="w-32 shrink-0"
    />
  );
}

export interface ApplyScopeChoice {
  scope: ApplyScope;
  /** The selection (or, with nothing selected, the screen) the scope was chosen on. */
  key: string;
}

/** A wider scope holds only while the layer or screen it was chosen on stays selected. */
export function resolveApplyScope(choice: ApplyScopeChoice | null, key: string): ApplyScope {
  return choice?.key === key ? choice.scope : "screen";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * What the next edit reaches, counting only screens it will really write: for a layer, sizes
 * without a matching unlocked layer or that cannot take its fitted values are reported as skipped.
 */
export function applyScopeSummary(layout: DesignLayout, screen: Screen, scope: ApplyScope, element?: Element): string {
  const { screens, skippedDestinations } = applyScopeScreens(layout, screen, scope);
  const reach = element
    ? scopedElementPatches(layout, screen.id, element.id, { type: element.type, patch: {} }, scope)
    : null;
  const count = reach ? reach.writes.length : screens.length;
  const name = (screen.variantOf ? layout.screens.find(({ id }) => id === screen.variantOf) : screen)?.name;
  return [
    count === 1
      ? "Edits change this screen only."
      : `One edit across ${count} exact-size screens in ${screen.locale.toUpperCase()}, one undo step.`,
    ...(reach?.skippedSizes
      ? [`${plural(reach.skippedSizes, "size")} skipped: no matching unlocked layer, or a value out of range there.`]
      : []),
    ...(skippedDestinations
      ? [`${plural(skippedDestinations, "destination")} skipped: no screen named “${name}” at this position.`]
      : []),
  ].join(" ");
}

/** Inspector footer: which exact-size screens the next edit writes to (Handoff 6a, 6c). */
export function ApplyScopeFooter({ layout, screen, specs, value, onChange, element }: ApplyScopeProps & {
  /** The selected layer; without it the scope covers screen fields such as Background. */
  element?: Element;
}) {
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
        {applyScopeSummary(layout, screen, value, element)}
      </p>
    </footer>
  );
}
