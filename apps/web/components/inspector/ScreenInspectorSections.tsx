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
import { editorUi, MenuSelect, SegmentedControl } from "@web/components/editor-ui";
import { ColorField, NumberField, SelectField, TextField } from "@web/components/inspector-fields";
import { InspectorSection as Section } from "./InspectorSection";

function editBackground(background: Background) {
  mutateAndScheduleSave(() => editorStore.getState().setBackground(background));
}

const GRADIENT_DIRECTIONS = [
  { value: "left-to-right", label: "Left → right", angle: 0 },
  { value: "top-left-to-bottom-right", label: "Top-left → bottom-right", angle: 45 },
  { value: "top-to-bottom", label: "Top → bottom", angle: 90 },
  { value: "top-right-to-bottom-left", label: "Top-right → bottom-left", angle: 135 },
  { value: "right-to-left", label: "Right → left", angle: 180 },
  { value: "bottom-right-to-top-left", label: "Bottom-right → top-left", angle: 225 },
  { value: "bottom-to-top", label: "Bottom → top", angle: 270 },
  { value: "bottom-left-to-top-right", label: "Bottom-left → top-right", angle: 315 },
] as const;

type GradientDirection = (typeof GRADIENT_DIRECTIONS)[number]["value"] | "custom";

const GRADIENT_DIRECTION_OPTIONS = [
  ...GRADIENT_DIRECTIONS.map(({ value, label }) => ({ value, label })),
  { value: "custom" as const, label: "Custom angle" },
];

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

function gradientDirection(angle: number): GradientDirection {
  const normalizedAngle = angle === 360 ? 0 : angle;
  return GRADIENT_DIRECTIONS.find((direction) => direction.angle === normalizedAngle)?.value
    ?? "custom";
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
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Artboard</h3>
          <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Explicit override</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
          <NumberField label="W" value={width} min={1} integer layout="column" onChange={setWidth} />
          <span className="pb-2 text-xs text-slate-400" aria-hidden="true">×</span>
          <NumberField label="H" value={height} min={1} integer layout="column" onChange={setHeight} />
          <span className="pb-2 text-[10px] text-slate-400">px</span>
        </div>
        <p className={`text-[10px] leading-4 ${draftStatus?.kind === "invalid" ? "text-red-600" : "text-slate-500"}`}>
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
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">Artboard</h3>
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
            className="artboard-size-value grid min-w-0 place-items-center whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-medium tabular-nums text-slate-700 motion-reduce:animate-none"
          >
            {screen.artboard.width} × {screen.artboard.height} px
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-medium tabular-nums text-slate-700">
          {screen.artboard.width} × {screen.artboard.height} px
        </div>
      )}
      <p className="text-[10px] leading-4 text-slate-500">
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
        <SelectField
          label="Type"
          value={background.type}
          options={["solid", "linear-gradient", "image"] as const}
          onChange={(type) => {
            const baseColor = background.type === "solid"
              ? background.color
              : background.type === "linear-gradient"
                ? background.from
                : background.color;
            if (type === "solid") editBackground({ type, color: baseColor });
            else if (type === "linear-gradient") editBackground({ type, from: baseColor, to: "#000000", angle: 0 });
            else if (background.type !== "image") onOpenBackgroundAsset?.();
          }}
        />
        {background.type === "solid" ? (
          <ColorField label="Color" value={background.color} onChange={(color) => editBackground({ ...background, color })} />
        ) : background.type === "linear-gradient" ? (
          <>
            <ColorField label="From" value={background.from} onChange={(from) => editBackground({ ...background, from })} />
            <ColorField label="To" value={background.to} onChange={(to) => editBackground({ ...background, to })} />
            <label className="flex items-center justify-between gap-3 text-xs">
              <span className="shrink-0 whitespace-nowrap text-slate-500">Direction</span>
              <MenuSelect
                ariaLabel="Gradient direction"
                value={gradientDirection(background.angle)}
                options={GRADIENT_DIRECTION_OPTIONS}
                onChange={(direction) => {
                  const preset = GRADIENT_DIRECTIONS.find(({ value }) => value === direction);
                  if (preset) editBackground({ ...background, angle: preset.angle });
                }}
                className="w-40"
              />
            </label>
            <NumberField label="Angle" value={background.angle} min={0} max={360} integer onChange={(angle) => editBackground({ ...background, angle })} />
          </>
        ) : (
          <>
            <TextField label="Asset URL" value={background.assetUrl} onChange={(assetUrl) => editBackground({ ...background, assetUrl })} />
            <SelectField
              label="Content mode"
              value={background.fit}
              options={["cover", "contain"] as const}
              optionLabels={{ cover: "Fill", contain: "Fit" }}
              onChange={(fit) => editBackground({ ...background, fit })}
            />
            <ColorField label="Fallback" value={background.color} onChange={(color) => editBackground({ ...background, color })} />
            {onOpenBackgroundAsset ? (
              <button type="button" className={editorUi.buttonSecondary} onClick={onOpenBackgroundAsset}>
                Choose project image
              </button>
            ) : null}
          </>
        )}
      </Section>
    </>
  );
}
