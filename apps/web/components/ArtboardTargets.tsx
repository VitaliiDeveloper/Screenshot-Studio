// SPDX-License-Identifier: Apache-2.0
"use client";

import type { Screen } from "@screenshot-studio/core/model";
import { artboardTargetStatuses, leadStoreSizeId, type StoreSpecs } from "@screenshot-studio/core/export";

/**
 * Inspector target-compatibility section (spec Slice 3). Shows how the active screen's artboard
 * maps to each store size for its platform/device — exact / proportional / invalid — and offers a
 * one-click "Set exact" per target. The lead (bundle) target is badged. Pure display over core's
 * framework-free status helpers; the actual mutation goes through the parent's save path.
 */
const STATUS_TEXT: Record<"exact" | "proportional" | "invalid", string> = {
  exact: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  proportional: "bg-amber-50 text-amber-700 ring-amber-200",
  invalid: "bg-red-50 text-red-700 ring-red-200",
};

const STATUS_LABEL: Record<"exact" | "proportional" | "invalid", string> = {
  exact: "exact",
  proportional: "proportional",
  invalid: "invalid aspect",
};

export function ArtboardTargets({
  screen,
  specs,
  onSetExact,
}: {
  screen: Screen;
  specs: StoreSpecs;
  onSetExact: (width: number, height: number) => void;
}) {
  const statuses = artboardTargetStatuses(screen, specs);
  let leadId: string | undefined;
  try {
    leadId = leadStoreSizeId(screen.platform, screen.device);
  } catch {
    leadId = undefined;
  }

  if (statuses.length === 0) {
    return <p className="text-xs text-slate-400">No store targets for {screen.platform}/{screen.device}.</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs font-medium text-slate-600">{screen.platform} / {screen.device}</p>
      {statuses.map(({ target, status }) => (
        <div key={target.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/70 p-2 text-xs">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-medium text-slate-700">
              {target.label}
              {target.id === leadId && (
                <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">lead</span>
              )}
            </span>
            <span className={`w-fit rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${STATUS_TEXT[status.kind]}`}>{STATUS_LABEL[status.kind]}</span>
          </span>
          <button
            className="min-h-7 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
            onClick={() => onSetExact(target.width, target.height)}
          >
            Set exact
          </button>
        </div>
      ))}
    </div>
  );
}
