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
  exact: "text-emerald-600",
  proportional: "text-amber-600",
  invalid: "text-red-600",
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
    return <p className="text-xs text-neutral-400">No store targets for {screen.platform}/{screen.device}.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-neutral-500">{screen.platform} / {screen.device}</p>
      {statuses.map(({ target, status }) => (
        <div key={target.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex flex-col">
            <span className="text-neutral-600">
              {target.label}
              {target.id === leadId && (
                <span className="ml-1 rounded bg-neutral-800 px-1 text-[10px] text-white">lead</span>
              )}
            </span>
            <span className={STATUS_TEXT[status.kind]}>{STATUS_LABEL[status.kind]}</span>
          </span>
          <button
            className="rounded border border-neutral-300 bg-white px-2 py-0.5 hover:bg-neutral-100"
            onClick={() => onSetExact(target.width, target.height)}
          >
            Set exact
          </button>
        </div>
      ))}
    </div>
  );
}
