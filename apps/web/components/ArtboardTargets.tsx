// SPDX-License-Identifier: Apache-2.0
"use client";

import type { Project, Screen } from "@screenshot-studio/core/model";
import { leadStoreSizeId, type StoreSize, type StoreSpecs } from "@screenshot-studio/core/export";
import { storeOutputLabel } from "../lib/editor-workspace";
import { AddMenu } from "./editor-ui";

/**
 * Store-target navigation never mutates the active artboard. The lead row opens the root/master;
 * non-lead rows create or open independent exact-target variants with fresh persisted identities.
 */
export function ArtboardTargets({
  project,
  screen,
  specs,
  onOpen,
  onCreateOutput,
  onCreate,
  onRemove,
}: {
  project: Project;
  screen: Screen;
  specs: StoreSpecs;
  onOpen: (screenId: string) => void;
  onCreateOutput: (platform: string, device: string, leadTarget: StoreSize) => void;
  onCreate: (target: StoreSize) => void;
  onRemove: (rootScreenId: string, targetId: string) => void;
}) {
  const targets = specs[screen.platform]?.[screen.device] ?? [];
  const families = Object.entries(specs).flatMap(([platform, devices]) =>
    Object.entries(devices).map(([device, sizes]) => ({ platform, device, sizes })),
  );
  const rootId = screen.variantOf ?? screen.id;
  const root = project.screens.find((candidate) => candidate.id === rootId) ?? screen;
  let leadId: string | undefined;
  try {
    leadId = leadStoreSizeId(screen.platform, screen.device);
  } catch {
    leadId = undefined;
  }

  if (targets.length === 0) {
    return <p className="text-xs text-slate-400">No store targets for {screen.platform}/{screen.device}.</p>;
  }

  const familyRows = families.map(({ platform, device, sizes }) => {
    const existingRoot = project.screens.find((candidate) =>
      candidate.variantOf === undefined
      && candidate.platform === platform
      && candidate.device === device
      && candidate.locale === screen.locale,
    );
    let familyLeadId: string | undefined;
    try {
      familyLeadId = leadStoreSizeId(platform, device);
    } catch {
      familyLeadId = undefined;
    }
    return {
      key: `${platform}/${device}`,
      platform,
      device,
      label: storeOutputLabel(platform, device),
      existingRoot,
      leadTarget: sizes.find((size) => size.id === familyLeadId) ?? sizes[0],
    };
  });
  const createdFamilies = familyRows.filter((family) => family.existingRoot);
  const availableFamilies = familyRows.filter((family) => !family.existingRoot && family.leadTarget);
  const variantsByTargetId = new Map(project.screens
    .filter((candidate) => candidate.variantOf === rootId && candidate.storeTargetId)
    .map((candidate) => [candidate.storeTargetId!, candidate]));
  const createdTargets = targets.filter((target) => target.id === leadId || variantsByTargetId.has(target.id));
  const availableTargets = targets.filter((target) => target.id !== leadId && !variantsByTargetId.has(target.id));

  return (
    <section className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Store outputs</h3>
          <AddMenu
            ariaLabel="Add output"
            menuLabel="Available store outputs"
            options={availableFamilies.map((family) => ({
              value: family.key,
              label: family.label,
              description: "Create from the current output",
            }))}
            onSelect={(key) => {
              const family = availableFamilies.find((candidate) => candidate.key === key);
              if (family?.leadTarget) onCreateOutput(family.platform, family.device, family.leadTarget);
            }}
          />
        </div>
        <p className="mt-1 text-[10px] leading-4 text-slate-500">Independent screen sets with their own size variants.</p>
      </div>

      <div className="flex flex-col gap-1.5" aria-label="Store output families">
        {createdFamilies.map(({ key, platform, device, label, existingRoot }) => {
          const isCurrentFamily = platform === screen.platform && device === screen.device;
          return (
            <div
              key={key}
              role="group"
              aria-label={`${label} output`}
              className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs ${isCurrentFamily ? "border-blue-200 bg-blue-50/70" : "border-slate-100 bg-slate-50/70"}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-700">{label}</span>
                <span className="mt-0.5 block text-[10px] text-emerald-700">
                  {isCurrentFamily ? "current output" : "created"}
                </span>
              </span>
              <button
                disabled={isCurrentFamily}
                className="min-h-7 shrink-0 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
                onClick={() => existingRoot && onOpen(existingRoot.id)}
              >
                {isCurrentFamily ? "Current" : "Open"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-100 pt-2.5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            {storeOutputLabel(screen.platform, screen.device)} sizes
          </p>
          <AddMenu
            ariaLabel="Add size"
            menuLabel={`Available ${storeOutputLabel(screen.platform, screen.device)} sizes`}
            options={availableTargets.map((target) => ({
              value: target.id,
              label: target.label,
              description: `${target.width} × ${target.height} px`,
            }))}
            onSelect={(targetId) => {
              const target = availableTargets.find((candidate) => candidate.id === targetId);
              if (target) onCreate(target);
            }}
          />
        </div>
      {createdTargets.map((target) => {
        const isLead = target.id === leadId;
        const variant = variantsByTargetId.get(target.id);
        const targetScreen = isLead ? root : variant;
        const isCurrent = targetScreen?.id === screen.id;
        return (
          <div
            key={target.id}
            role="group"
            aria-label={`${target.label} store target`}
            className={`mb-1.5 flex items-center justify-between gap-2 rounded-lg border p-2 text-xs ${isCurrent ? "border-blue-200 bg-blue-50/70" : "border-slate-100 bg-slate-50/70"}`}
          >
          <span className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-medium text-slate-700">
              {target.label}
              {isLead && (
                <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">lead</span>
              )}
            </span>
            <span className={`w-fit rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${targetScreen ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>
              {isLead ? "master" : "variant"}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {variant && (
              <button
                className="min-h-7 rounded-lg px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
                onClick={() => {
                  if (window.confirm(`Remove the independent ${target.label} variant? The master stays unchanged.`)) {
                    onRemove(rootId, target.id);
                  }
                }}
              >
                Remove
              </button>
            )}
            <button
              disabled={isCurrent}
              className="min-h-7 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
              onClick={() => targetScreen && onOpen(targetScreen.id)}
            >
              {isCurrent ? "Current" : "Open"}
            </button>
          </span>
          </div>
        );
      })}
      </div>
    </section>
  );
}
