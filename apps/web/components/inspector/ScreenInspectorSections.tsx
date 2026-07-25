// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import type { Background, DesignLayout, Screen } from "@screenshot-studio/core/model";
import {
  artboardTargetStatus,
  type StoreSize,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { editorStore } from "@web/lib/editor-store";
import { mutateAndSave, mutateAndScheduleSave } from "@web/lib/mutate-and-save";
import { ArtboardTargets } from "@web/components/ArtboardTargets";
import { editorUi, SegmentedControl } from "@web/components/editor-ui";
import { NumberField } from "@web/components/inspector-fields";
import { BackgroundInspectorFields } from "./BackgroundInspectorFields";
import { InspectorSection as Section } from "./InspectorSection";

function editBackground(background: Background) {
  mutateAndScheduleSave(() => editorStore.getState().setBackground(background));
}

const STORE_AUTHORING_SCALES = ["1", "2", "3"] as const;
export type StoreAuthoringScale = (typeof STORE_AUTHORING_SCALES)[number];

export function storeAuthoringSize(
  target: Pick<StoreSize, "width" | "height">,
  scale: StoreAuthoringScale,
): { width: number; height: number } {
  const multiplier = Number(scale);
  return {
    width: target.width * multiplier,
    height: target.height * multiplier,
  };
}

export function storeAuthoringScale(
  artboard: { width: number; height: number },
  target: Pick<StoreSize, "width" | "height">,
): StoreAuthoringScale | undefined {
  return STORE_AUTHORING_SCALES.find((scale) => {
    const size = storeAuthoringSize(target, scale);
    return artboard.width === size.width && artboard.height === size.height;
  });
}

function targetExportDescription(target: StoreSize): string {
  const label = target.label.replace(/ \(lead\)$/u, "");
  return `Exports at ${target.width} × ${target.height} px for ${label}.`;
}

function ArtboardSizeEditor({
  screen,
  target,
}: {
  screen: Screen;
  target: StoreSize | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [width, setWidth] = useState(screen.artboard.width);
  const [height, setHeight] = useState(screen.artboard.height);
  const status = target ? artboardTargetStatus(screen.artboard, target) : undefined;
  const draftStatus = target ? artboardTargetStatus({ width, height }, target) : undefined;
  const authoringScale = target ? storeAuthoringScale(screen.artboard, target) : undefined;
  const resize = (size: { width: number; height: number }) => {
    mutateAndSave(() => editorStore.getState().resizeArtboard(size));
    setEditing(false);
  };

  if (editing && target) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[length:var(--editor-font-label-size)] font-semibold uppercase tracking-[var(--editor-font-label-tracking)] text-[color:var(--editor-color-text-muted)]">Artboard</h3>
          <span className="rounded-md bg-[var(--editor-color-warning-surface)] px-1.5 py-0.5 text-[length:var(--editor-font-label-size)] font-medium text-[color:var(--editor-color-warning-text)]">Explicit override</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
          <NumberField label="W" value={width} min={1} integer layout="column" onChange={setWidth} />
          <span className="pb-2 text-xs text-[color:var(--editor-color-text-subtle)]" aria-hidden="true">×</span>
          <NumberField label="H" value={height} min={1} integer layout="column" onChange={setHeight} />
          <span className="pb-2 text-[length:var(--editor-font-label-size)] text-[color:var(--editor-color-text-subtle)]">px</span>
        </div>
        <p className={`text-[length:var(--editor-font-label-size)] leading-4 ${draftStatus?.kind === "invalid" ? "text-[color:var(--editor-color-danger)]" : "text-[color:var(--editor-color-text-secondary)]"}`}>
          {draftStatus?.kind === "invalid"
            ? "Custom dimensions must keep the Store Target aspect ratio."
            : "Apply resizes every screen in this Store Target output and fits each composition."}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button className={editorUi.buttonSecondary} onClick={() => setEditing(false)}>Cancel</button>
          <button
            className={editorUi.buttonPrimary}
            disabled={draftStatus?.kind === "invalid" || (width === screen.artboard.width && height === screen.artboard.height)}
            onClick={() => resize({ width, height })}
          >
            Apply size
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[length:var(--editor-font-label-size)] font-semibold uppercase tracking-[var(--editor-font-label-tracking)] text-[color:var(--editor-color-text-muted)]">Artboard</h3>
        <SegmentedControl
          label="Artboard size mode"
          value={!target ? undefined : authoringScale ? "store" : "custom"}
          options={[
            {
              value: "store",
              label: "Store size",
              ariaLabel: "Use Store size",
              disabled: !target,
            },
            {
              value: "custom",
              label: "Custom",
              ariaLabel: "Use custom artboard size",
              disabled: !target,
            },
          ]}
          onChange={(mode) => {
            if (!target) return;
            if (mode === "store") {
              if (!authoringScale) resize(storeAuthoringSize(target, "1"));
              return;
            }
            setWidth(screen.artboard.width);
            setHeight(screen.artboard.height);
            setEditing(true);
          }}
        />
      </div>
      {target && authoringScale ? (
        <div className="grid grid-cols-[7.75rem_minmax(0,1fr)] items-stretch gap-2">
          <SegmentedControl
            label="Store authoring scale"
            value={authoringScale}
            options={STORE_AUTHORING_SCALES.map((scale) => ({
              value: scale,
              label: `${scale}×`,
              ariaLabel: `Use ${scale}× authoring scale`,
            }))}
            fill
            className="min-w-0 [&_button]:min-w-0 [&_button]:px-2"
            onChange={(scale) => resize(storeAuthoringSize(target, scale))}
          />
          <div
            key={`${screen.artboard.width}:${screen.artboard.height}`}
            aria-label="Authoring canvas size"
            className="artboard-size-value grid min-w-0 place-items-center whitespace-nowrap rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] px-2 text-xs font-medium tabular-nums text-[color:var(--editor-color-text-default)] motion-reduce:animate-none"
          >
            {screen.artboard.width} × {screen.artboard.height} px
          </div>
        </div>
      ) : (
        <div className="rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] px-3 py-2 text-right text-xs font-medium tabular-nums text-[color:var(--editor-color-text-default)]">
          {screen.artboard.width} × {screen.artboard.height} px
        </div>
      )}
      <p className="text-[length:var(--editor-font-label-size)] leading-4 text-[color:var(--editor-color-text-secondary)]">
        {!target
          ? "This screen references a Store Target that is unavailable."
          : status?.kind === "invalid"
            ? "This custom size does not match the Store Target aspect ratio."
            : targetExportDescription(target)}
      </p>
    </div>
  );
}

export function ScreenInspectorSections({
  layout,
  screen,
  specs,
  target,
  onOpenBackgroundAsset,
}: {
  layout: DesignLayout;
  screen: Screen;
  specs: StoreSpecs | null;
  target: StoreSize | undefined;
  onOpenBackgroundAsset?: () => void;
}) {
  const background = screen.background;
  return (
    <>
      <Section>
        <ArtboardSizeEditor
          key={`${screen.id}:${screen.artboard.width}:${screen.artboard.height}`}
          screen={screen}
          target={target}
        />
      </Section>
      {specs && (
        <ArtboardTargets
          layout={layout}
          screen={screen}
          specs={specs}
          onOpen={(screenId) => editorStore.getState().selectScreen(screenId)}
          onCreateOutput={(platform, device, target) => mutateAndSave(
            () => editorStore.getState().ensureStoreOutputFamily(platform, device, target),
          )}
          onRemoveOutput={(sourceScreenId) => mutateAndSave(
            () => editorStore.getState().removeStoreOutputFamily(sourceScreenId),
          )}
          onCreate={(target) => mutateAndSave(() => editorStore.getState().ensureStoreTargetVariant(target))}
          onRemove={(rootScreenId, targetId) => mutateAndSave(
            () => editorStore.getState().removeStoreTargetVariant(rootScreenId, targetId),
          )}
          onScreenSetModeChange={(mode) => mutateAndSave(
            () => editorStore.getState().setOutputFamilyScreenSetMode(mode),
          )}
        />
      )}
      <Section title="Background">
        <BackgroundInspectorFields
          background={background}
          onChange={editBackground}
          onChooseImage={onOpenBackgroundAsset}
        />
      </Section>
    </>
  );
}
