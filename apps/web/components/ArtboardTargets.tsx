// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  isPrimaryScreen,
  sameOutputFamily,
  screenSetModeFor,
  type DesignLayout,
  type Screen,
  type ScreenSetMode,
} from "@screenshot-studio/core/model";
import {
  destinationLabel,
  leadStoreSizeId,
  listOutputFamilies,
  listStoreTargets,
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
  const families = listOutputFamilies(specs).map(({ key, platform, device, creatable }) => ({
    key,
    platform,
    device,
    creatable,
    sizes: listStoreTargets(specs, platform, device),
  }));
  const root = screen.variantOf
    ? layout.screens.find((candidate) => candidate.id === screen.variantOf)
    : isPrimaryScreen(screen)
      ? screen
      : layout.screens.find((candidate) => sameOutputFamily(candidate, screen) && isPrimaryScreen(candidate));
  const rootId = root?.id;
  const screenSetMode = root ? screenSetModeFor(layout, root) : "independent";
  let leadId: string | undefined;
  try {
    leadId = leadStoreSizeId(specs, screen.platform, screen.device);
  } catch {
    leadId = undefined;
  }

  if (targets.length === 0) {
    return <p className="text-xs text-[color:var(--editor-color-text-subtle)]">No store listing sizes for {storeOutputLabel(screen.platform, screen.device, specs)}.</p>;
  }

  const familyRows = families.map(({ platform, device, creatable, sizes }) => {
    const existingRoot = layout.screens.find((candidate) =>
      isPrimaryScreen(candidate)
      && candidate.platform === platform
      && candidate.device === device
      && candidate.locale === screen.locale,
    );
    let familyLeadId: string | undefined;
    try {
      familyLeadId = leadStoreSizeId(specs, platform, device);
    } catch {
      familyLeadId = undefined;
    }
    return {
      key: `${platform}/${device}`,
      platform,
      device,
      creatable,
      existingRoot,
      leadTarget: sizes.find((size) => size.id === familyLeadId) ?? sizes[0],
    };
  });
  const createdFamilies = familyRows.filter((family) => family.existingRoot);
  const availableFamilies = root
    ? familyRows.filter((family) => (
        !family.existingRoot
        && family.leadTarget
        && family.creatable
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
    const displayLabel = conciseStoreTargetLabel(target, screen.platform, screen.device, specs);
    const canRemove = !isLead && root !== undefined && targetScreen !== undefined;
    return (
      <div
        key={target.id}
        role="group"
        aria-label={`${displayLabel} output target`}
        aria-current={isCurrent ? "true" : undefined}
        className={`relative mb-1.5 flex items-center justify-between gap-2 rounded-[var(--editor-radius-control)] border p-2.5 text-xs transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] ${isCurrent ? "border-[var(--editor-color-accent-muted)] bg-[var(--editor-color-accent-subtle)]" : `border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] ${targetScreen ? "cursor-pointer hover:border-[var(--editor-color-accent-muted)] hover:bg-[var(--editor-color-accent-subtle)]" : ""}`}`}
      >
        {!isCurrent && targetScreen ? (
          <button
            type="button"
            aria-label={`Open ${displayLabel}`}
            title={`Open ${displayLabel}`}
            className="absolute inset-0 rounded-[var(--editor-radius-control)] focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)]"
            onClick={() => onOpen(targetScreen.id)}
          />
        ) : null}
        <span className="pointer-events-none relative z-[1] flex min-w-0 flex-col gap-1">
          <span data-testid="store-target-name" className="truncate font-semibold text-[color:var(--editor-color-text-default)]">
            {displayLabel}
          </span>
          <span className="text-[length:var(--editor-font-label-size)] text-[color:var(--editor-color-text-muted)]">{dimensionsLabel(target)}</span>
        </span>
        <span className="pointer-events-none relative z-[2] flex shrink-0 items-center gap-1">
          <span
            data-testid="store-target-role"
            className={isLead
              ? "rounded-full bg-[var(--editor-color-text-strong)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--editor-color-on-accent)]"
              : "rounded-full bg-[var(--editor-color-surface-muted)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--editor-color-text-muted)]"}
          >
            {isLead ? "Master" : "Variant"}
          </span>
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
    <div className="border-t border-[var(--editor-color-surface-muted)] pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[length:var(--editor-font-label-size)] font-semibold uppercase tracking-[var(--editor-font-label-tracking)] text-[color:var(--editor-color-text-secondary)]">
          {title}
        </p>
        <AddMenu
          ariaLabel={ariaLabel}
          menuLabel={`Available ${title.toLowerCase()}`}
          menuClassName="menu-select-surface"
          options={available.map((target) => ({
            value: target.id,
            label: conciseStoreTargetLabel(target, screen.platform, screen.device, specs),
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
      className="flex flex-col gap-3 border-b border-[var(--editor-color-border)] px-4 py-4"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[length:var(--editor-font-label-size)] font-semibold uppercase tracking-[var(--editor-font-label-tracking)] text-[color:var(--editor-color-text-muted)]">Destinations</h3>
          <AddMenu
            ariaLabel="Add destination"
            menuLabel="Available destinations"
            menuClassName="menu-select-surface"
            options={availableFamilies.map((family) => ({
              value: family.key,
              label: `${destinationLabel(family.platform, specs)} · ${outputFamilyEditorLabel(family.platform, family.device, specs)}`,
            }))}
            onSelect={(key) => {
              const family = availableFamilies.find((candidate) => candidate.key === key);
              if (family?.leadTarget) onCreateOutput(family.platform, family.device, family.leadTarget);
            }}
          />
        </div>
        {createdFamilies.map(({ key, platform, device, existingRoot }) => {
          const isCurrentFamily = platform === screen.platform && device === screen.device;
          const familyLabel = outputFamilyEditorLabel(platform, device, specs);
          const destination = destinationLabel(platform, specs);
          const canRemove = createdFamilies.length > 1 && existingRoot !== undefined;
          return (
            <div
              key={key}
              role="group"
              aria-label={`${destination} · ${familyLabel} output`}
              aria-current={isCurrentFamily ? "true" : undefined}
              className={`relative flex items-center justify-between gap-2 rounded-[var(--editor-radius-control)] border px-2.5 py-2 text-xs transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] ${isCurrentFamily ? "border-[var(--editor-color-accent-muted)] bg-[var(--editor-color-accent-subtle)]" : `border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] ${existingRoot ? "cursor-pointer hover:border-[var(--editor-color-accent-muted)] hover:bg-[var(--editor-color-accent-subtle)]" : ""}`}`}
            >
              {!isCurrentFamily && existingRoot ? (
                <button
                  type="button"
                  aria-label={`Open ${destination} · ${familyLabel} output`}
                  title={`Open ${destination} · ${familyLabel} output`}
                  className="absolute inset-0 rounded-[var(--editor-radius-control)] focus-visible:outline-none focus-visible:ring-[length:var(--editor-focus-width)] focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)]"
                  onClick={() => onOpen(existingRoot.id)}
                />
              ) : null}
              <span className="pointer-events-none relative z-[1] min-w-0 space-y-0.5">
                <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--editor-color-text-muted)]">
                  <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-[var(--editor-motion-fast)] ease-[var(--editor-motion-ease)] ${isCurrentFamily ? "bg-[var(--editor-color-accent)]" : "bg-[var(--editor-color-border-strong)]"}`} aria-hidden="true" />
                  {destination}
                </span>
                <span className="block truncate font-semibold text-[color:var(--editor-color-text-default)]">{familyLabel}</span>
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
