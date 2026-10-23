// SPDX-License-Identifier: Apache-2.0
"use client";

import { destinationLabel, type StoreSize, type StoreSpecs } from "@screenshot-studio/core/export";
import type { DesignLayout, Screen } from "@screenshot-studio/core/model";
import { screenTargetLabel } from "@web/lib/editor/editor-issues";
import { outputFamilyEditorLabel } from "@web/lib/editor/editor-workspace";
import { InspectorSection as Section } from "./InspectorSection";

/** The identity a screen persists (Handoff 6c): read-only, because another locale or size is another screen. */
export function StoredOnThisScreenSection({
  layout,
  screen,
  specs,
  target,
}: {
  layout: DesignLayout;
  screen: Screen;
  specs: StoreSpecs | null;
  target: StoreSize | undefined;
}) {
  const family = outputFamilyEditorLabel(screen.platform, screen.device, specs ?? undefined);
  const size = specs ? screenTargetLabel(screen, specs) : null;
  const rows = [
    ["Locale", `${screen.locale.toUpperCase()} · ${screen.direction.toUpperCase()}`],
    ["Destination", `${destinationLabel(screen.platform, specs ?? undefined)} · ${family}`],
    ["Size", size && target ? `${size} · ${target.width}\u00a0×\u00a0${target.height}` : "Store size unavailable"],
    ["Layout", layout.name],
  ] as const;
  return (
    <Section title="Stored on this screen">
      <dl className="flex flex-col gap-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3">
            <dt className="w-20 shrink-0 text-[color:var(--editor-color-text-secondary)]">{label}</dt>
            <dd className="min-w-0 flex-1 tabular-nums text-[color:var(--editor-color-text-default)]">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] leading-4 text-[color:var(--editor-color-text-secondary)]">
        Each locale and size is its own screen. Switch screens to edit another.
      </p>
    </Section>
  );
}
