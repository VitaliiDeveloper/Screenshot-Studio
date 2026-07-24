// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  destinationLabel,
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
import {
  conciseStoreTargetLabel,
  outputFamilyEditorLabel,
  storeOutputLabel,
} from "@web/lib/editor-workspace";
import { AddMenu, ConfirmationDialog, editorUi, SegmentedControl } from "./editor-ui";

function dimensionsLabel(target: StoreSize): string {
  return `${target.width} × ${target.height} px`;
}

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
  onRemoveOutput,
  onCreate,
  onRemove,
  onScreenSetModeChange,
}: {
  layout: DesignLayout;
  screen: Screen;
  specs: StoreSpecs;
  onOpen: (screenId: string) => void;
  onCreateOutput: (platform: string, device: string, leadTarget: StoreSize) => void;
  onRemoveOutput: (sourceScreenId: string) => void;
  onCreate: (target: StoreSize) => void;
  onRemove: (rootScreenId: string, targetId: string) => void;
  onScreenSetModeChange: (mode: ScreenSetMode) => void;
}) {
  const [pendingRemoval, setPendingRemoval] = useState<{
    rootScreenId: string;
    targetId: string;
    label: string;
  } | null>(null);
  const [pendingFamilyRemoval, setPendingFamilyRemoval] = useState<{
    sourceScreenId: string;
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
  const renderTargetCards = (groupTargets: StoreSize[]) => groupTargets.map((target) => {
    const isLead = root !== undefined && target.id === leadId;
    const rootVariant = rootVariantsByTargetId.get(target.id);
    const targetScreen = isLead
      ? root
      : rootVariant ?? familyVariantsByTargetId.get(target.id);
    const isCurrent = target.id === leadId
      ? isPrimaryScreen(screen)
      : screen.storeTargetId === target.id;
    const displayLabel = conciseStoreTargetLabel(target, screen.platform, screen.device);
    const canRemove = !isLead && root !== undefined && targetScreen !== undefined;
    return (
      <div
        key={target.id}
        role="group"
        aria-label={`${displayLabel} output target`}
        aria-current={isCurrent ? "true" : undefined}
        className={`relative mb-1.5 flex items-center justify-between gap-2 rounded-lg border p-2.5 text-xs transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] ${isCurrent ? "border-blue-200 bg-blue-50/70" : `border-slate-200 bg-white ${targetScreen ? "cursor-pointer hover:border-blue-200 hover:bg-blue-50/40" : ""}`}`}
      >
        {!isCurrent && targetScreen ? (
          <button
            type="button"
            aria-label={`Open ${displayLabel}`}
            title={`Open ${displayLabel}`}
            className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60"
            onClick={() => onOpen(targetScreen.id)}
          />
        ) : null}
        <span className="pointer-events-none relative z-[1] flex min-w-0 flex-col gap-1">
          <span data-testid="store-target-name" className="truncate font-semibold text-slate-700">
            {displayLabel}
          </span>
          <span className="text-[10px] text-slate-400">{dimensionsLabel(target)}</span>
        </span>
        <span className="pointer-events-none relative z-[2] flex shrink-0 items-center gap-1">
          {isLead ? (
            <span
              data-testid="store-target-roles"
              className="rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white"
            >
              Primary
            </span>
          ) : null}
          {canRemove && targetScreen ? (
            <button
              type="button"
              aria-label={`Remove ${displayLabel} output`}
              title={`Remove ${displayLabel} output`}
              className={`${editorUi.rowIconButtonDanger} pointer-events-auto`}
              onClick={() => setPendingRemoval({
                rootScreenId: targetScreen.variantOf ?? targetScreen.id,
                targetId: target.id,
                label: displayLabel,
              })}
            >
              <Trash2 size={14} strokeWidth={1.9} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      </div>
    );
  });

  const renderTargetSection = ({
    title,
    ariaLabel,
    created,
    available,
  }: {
    title: string;
    ariaLabel: string;
    created: StoreSize[];
    available: StoreSize[];
  }) => (
    <div className="border-t border-slate-100 pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          {title}
        </p>
        <AddMenu
          ariaLabel={ariaLabel}
          menuLabel={`Available ${title.toLowerCase()}`}
          menuClassName="menu-select-surface"
          options={available.map((target) => ({
            value: target.id,
            label: conciseStoreTargetLabel(target, screen.platform, screen.device),
            description: dimensionsLabel(target),
          }))}
          onSelect={(targetId) => {
            const target = available.find((candidate) => candidate.id === targetId);
            if (target) onCreate(target);
          }}
        />
      </div>
      {renderTargetCards(created)}
    </div>
  );

  return (
    <section
      data-testid="store-outputs-section"
      className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Destinations</h3>
          <AddMenu
            ariaLabel="Add destination"
            menuLabel="Available destinations"
            menuClassName="menu-select-surface"
            options={availableFamilies.map((family) => ({
              value: family.key,
              label: `${destinationLabel(family.platform)} · ${outputFamilyEditorLabel(family.platform, family.device)}`,
            }))}
            onSelect={(key) => {
              const family = availableFamilies.find((candidate) => candidate.key === key);
              if (family?.leadTarget) onCreateOutput(family.platform, family.device, family.leadTarget);
            }}
          />
        </div>
        {createdFamilies.map(({ key, platform, device, existingRoot }) => {
          const isCurrentFamily = platform === screen.platform && device === screen.device;
          const familyLabel = outputFamilyEditorLabel(platform, device);
          const destination = destinationLabel(platform);
          const canRemove = createdFamilies.length > 1 && existingRoot !== undefined;
          return (
            <div
              key={key}
              role="group"
              aria-label={`${destination} · ${familyLabel} output`}
              aria-current={isCurrentFamily ? "true" : undefined}
              className={`relative flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] ${isCurrentFamily ? "border-blue-200 bg-blue-50/70" : `border-slate-200 bg-white ${existingRoot ? "cursor-pointer hover:border-blue-200 hover:bg-blue-50/40" : ""}`}`}
            >
              {!isCurrentFamily && existingRoot ? (
                <button
                  type="button"
                  aria-label={`Open ${destination} · ${familyLabel} output`}
                  title={`Open ${destination} · ${familyLabel} output`}
                  className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60"
                  onClick={() => onOpen(existingRoot.id)}
                />
              ) : null}
              <span className="pointer-events-none relative z-[1] min-w-0 space-y-0.5">
                <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                  <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] ${isCurrentFamily ? "bg-blue-500" : "bg-slate-300"}`} aria-hidden="true" />
                  {destination}
                </span>
                <span className="block truncate font-semibold text-slate-700">{familyLabel}</span>
              </span>
              {canRemove && existingRoot ? (
                <button
                  type="button"
                  aria-label={`Remove ${destination} · ${familyLabel} output`}
                  title={`Remove ${destination} · ${familyLabel} output`}
                  className={`${editorUi.rowIconButtonDanger} pointer-events-auto relative z-[2]`}
                  onClick={() => setPendingFamilyRemoval({
                    sourceScreenId: existingRoot.id,
                    label: `${destination} · ${familyLabel}`,
                  })}
                >
                  <Trash2 size={14} strokeWidth={1.9} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {root ? <div className={`${editorUi.insetPanel} gap-2`}>
        <span className={editorUi.sectionLabel}>Screen structure</span>
        <SegmentedControl
          label="Screen structure behavior"
          value={screenSetMode}
          fill
          options={[
            { value: "independent", label: "Separate" },
            { value: "synchronized", label: "Sync structure" },
          ]}
          onChange={onScreenSetModeChange}
        />
        <p className="text-[10px] leading-4 text-[color:var(--editor-color-text-secondary)]">
          {screenSetMode === "synchronized"
            ? "Additions, deletions, and order stay synchronized. Content remains independent for every size."
            : "Each size keeps its own screen count and order."}
        </p>
      </div> : null}

      {renderTargetSection({
        title: "Output sizes",
        ariaLabel: "Add output size",
        created: createdTargets,
        available: availableTargets,
      })}
      {pendingRemoval ? (
        <ConfirmationDialog
          title="Remove output size?"
          description={screenSetMode === "synchronized"
            ? `Remove ${pendingRemoval.label} from every synchronized screen slot? The primary output stays unchanged.`
            : `Remove ${pendingRemoval.label}? The primary output stays unchanged.`}
          confirmLabel="Remove output"
          onClose={() => setPendingRemoval(null)}
          onConfirm={() => {
            const removal = pendingRemoval;
            setPendingRemoval(null);
            onRemove(removal.rootScreenId, removal.targetId);
          }}
        />
      ) : null}
      {pendingFamilyRemoval ? (
        <ConfirmationDialog
          title="Remove output target?"
          description={`Remove ${pendingFamilyRemoval.label} and all of its screen sizes from this locale?`}
          confirmLabel="Remove output"
          onClose={() => setPendingFamilyRemoval(null)}
          onConfirm={() => {
            const removal = pendingFamilyRemoval;
            setPendingFamilyRemoval(null);
            onRemoveOutput(removal.sourceScreenId);
          }}
        />
      ) : null}
    </section>
  );
}
