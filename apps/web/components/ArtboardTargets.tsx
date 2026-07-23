// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import { ArrowRight, Trash2 } from "lucide-react";
import {
  isPrimaryScreen,
  OUTPUT_DEVICE_FAMILIES,
  sameOutputFamily,
  screenSetModeFor,
  type DesignLayout,
  type Screen,
  type ScreenSetMode,
} from "@screenshot-studio/core/model";
import {
  leadStoreSizeId,
  listStoreTargets,
  STORE_OUTPUT_TARGETS_KEY,
  type StoreSize,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { storeOutputLabel } from "@web/lib/editor-workspace";
import { AddMenu, ConfirmationDialog, editorUi, SegmentedControl } from "./editor-ui";

/**
 * Store-target navigation never mutates the active artboard. The lead row opens the root/master;
 * non-lead rows create or open exact-target variants with fresh persisted identities. Screen-slot
 * synchronization is an authoring policy and never changes target identity or rendered pixels.
 */
export function ArtboardTargets({
  layout,
  screen,
  specs,
  onOpen,
  onCreateOutput,
  onCreate,
  onRemove,
  onScreenSetModeChange,
}: {
  layout: DesignLayout;
  screen: Screen;
  specs: StoreSpecs;
  onOpen: (screenId: string) => void;
  onCreateOutput: (platform: string, device: string, leadTarget: StoreSize) => void;
  onCreate: (target: StoreSize) => void;
  onRemove: (rootScreenId: string, targetId: string) => void;
  onScreenSetModeChange: (mode: ScreenSetMode) => void;
}) {
  const [pendingRemoval, setPendingRemoval] = useState<{
    rootScreenId: string;
    targetId: string;
    label: string;
  } | null>(null);
  const targets: StoreSize[] = (() => {
    try {
      return listStoreTargets(specs, screen.platform, screen.device);
    } catch {
      return [];
    }
  })();
  const families = Object.entries(specs).flatMap(([platform, devices]) =>
    Object.entries(devices)
      .filter(([device]) => device !== STORE_OUTPUT_TARGETS_KEY)
      .map(([device, sizes]) => ({ platform, device, sizes })),
  );
  const root = screen.variantOf
    ? layout.screens.find((candidate) => candidate.id === screen.variantOf)
    : isPrimaryScreen(screen)
      ? screen
      : layout.screens.find((candidate) => sameOutputFamily(candidate, screen) && isPrimaryScreen(candidate));
  const rootId = root?.id;
  const screenSetMode = root ? screenSetModeFor(layout, root) : "independent";
  let leadId: string | undefined;
  try {
    leadId = leadStoreSizeId(screen.platform, screen.device);
  } catch {
    leadId = undefined;
  }

  if (targets.length === 0) {
    return <p className="text-xs text-slate-400">No store listing sizes for {storeOutputLabel(screen.platform, screen.device)}.</p>;
  }

  const familyRows = families.map(({ platform, device, sizes }) => {
    const existingRoot = layout.screens.find((candidate) =>
      isPrimaryScreen(candidate)
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
  const availableFamilies = root
    ? familyRows.filter((family) => (
        !family.existingRoot
        && family.leadTarget
        && OUTPUT_DEVICE_FAMILIES.some(({ key, creatable }) => key === family.key && creatable)
      ))
    : [];
  const familyVariantsByTargetId = new Map<string, Screen>();
  const rootVariantsByTargetId = new Map<string, Screen>();
  for (const candidate of layout.screens) {
    if (
      !candidate.storeTargetId
      || candidate.platform !== screen.platform
      || candidate.device !== screen.device
      || candidate.locale !== screen.locale
    ) continue;
    familyVariantsByTargetId.set(candidate.storeTargetId, (
      familyVariantsByTargetId.get(candidate.storeTargetId) ?? candidate
    ));
    if (rootId && candidate.variantOf === rootId) {
      rootVariantsByTargetId.set(candidate.storeTargetId, candidate);
    }
  }
  const createdTargets = targets.filter((target) => (
    (root !== undefined && target.id === leadId) || familyVariantsByTargetId.has(target.id)
  ));
  const availableTargets = root
    ? targets.filter((target) => target.id !== leadId && !familyVariantsByTargetId.has(target.id))
    : [];

  return (
    <section
      data-testid="store-outputs-section"
      className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4"
    >
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Output targets</h3>
          <AddMenu
            ariaLabel="Add output"
            menuLabel="Available output targets"
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
        {root ? <div className={`${editorUi.insetPanel} mt-3 gap-2`}>
          <span className={editorUi.sectionLabel}>Screen slots</span>
          <SegmentedControl
            label="Screen slot behavior"
            value={screenSetMode}
            fill
            options={[
              { value: "independent", label: "Independent" },
              { value: "synchronized", label: "Keep 1:1" },
            ]}
            onChange={onScreenSetModeChange}
          />
          <p className="text-[10px] leading-4 text-[color:var(--editor-color-text-secondary)]">
            {screenSetMode === "synchronized"
              ? "Add, delete, and order mirror across sizes. Layer edits stay independent."
              : "Each size keeps its own screen count and order."}
          </p>
        </div> : null}
      </div>

      <div className="flex flex-col gap-1.5" aria-label="Output target families">
        {createdFamilies.map(({ key, platform, device, label, existingRoot }) => {
          const isCurrentFamily = platform === screen.platform && device === screen.device;
          return (
            <div
              key={key}
              role="group"
              aria-label={`${label} output`}
              aria-current={isCurrentFamily ? "true" : undefined}
              className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-xs ${isCurrentFamily ? "border-blue-200 bg-blue-50/70" : "border-slate-100 bg-slate-50/70"}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-700">{label}</span>
                <span className="mt-0.5 block text-[10px] text-emerald-700">created</span>
              </span>
              {!isCurrentFamily && existingRoot ? (
                <button
                  type="button"
                  aria-label={`Open ${label} output`}
                  title={`Open ${label} output`}
                  className={`${editorUi.rowIconButton} border border-slate-200 bg-white shadow-sm`}
                  onClick={() => onOpen(existingRoot.id)}
                >
                  <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-100 pt-2.5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Store listing sizes
          </p>
          <AddMenu
            ariaLabel="Add size"
            menuLabel={`Available ${storeOutputLabel(screen.platform, screen.device)} store listing sizes`}
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
        const isLead = root !== undefined && target.id === leadId;
        const rootVariant = rootVariantsByTargetId.get(target.id);
        const targetScreen = isLead
          ? root
          : rootVariant ?? familyVariantsByTargetId.get(target.id);
        const isCurrent = target.id === leadId
          ? isPrimaryScreen(screen)
          : screen.storeTargetId === target.id;
        return (
          <div
            key={target.id}
            role="group"
            aria-label={`${target.label} store target`}
            aria-current={isCurrent ? "true" : undefined}
            className={`mb-1.5 flex items-center justify-between gap-2 rounded-lg border p-2 text-xs ${isCurrent ? "border-blue-200 bg-blue-50/70" : "border-slate-100 bg-slate-50/70"}`}
          >
          <span className="flex min-w-0 flex-col gap-1">
            <span data-testid="store-target-name" className="truncate font-medium text-slate-700">
              {isLead ? target.label.replace(/\s+\(lead\)$/i, "") : target.label}
            </span>
            <span data-testid="store-target-roles" className="flex w-fit items-center gap-1">
              {isLead && (
                <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white">lead</span>
              )}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${targetScreen ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}>
                {isLead ? "master" : "variant"}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {!isLead && root && targetScreen && (
              <button
                type="button"
                aria-label={`Remove ${target.label} variant`}
                title={`Remove ${target.label} variant`}
                className={editorUi.rowIconButtonDanger}
                onClick={() => setPendingRemoval({
                  rootScreenId: targetScreen.variantOf ?? targetScreen.id,
                  targetId: target.id,
                  label: target.label,
                })}
              >
                <Trash2 size={14} strokeWidth={1.9} aria-hidden="true" />
              </button>
            )}
            {!isCurrent && targetScreen ? (
              <button
                type="button"
                aria-label={`Open ${target.label}`}
                title={`Open ${target.label}`}
                className={`${editorUi.rowIconButton} border border-slate-200 bg-white shadow-sm`}
                onClick={() => onOpen(targetScreen.id)}
              >
                <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            ) : null}
          </span>
          </div>
        );
      })}
      </div>
      {pendingRemoval ? (
        <ConfirmationDialog
          title="Remove size variant?"
          description={screenSetMode === "synchronized"
            ? `Remove ${pendingRemoval.label} from every synchronized screen slot? The primary size stays unchanged.`
            : `Remove the independent ${pendingRemoval.label} variant? The primary size stays unchanged.`}
          confirmLabel="Remove size"
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => {
            const removal = pendingRemoval;
            setPendingRemoval(null);
            onRemove(removal.rootScreenId, removal.targetId);
          }}
        />
      ) : null}
    </section>
  );
}
