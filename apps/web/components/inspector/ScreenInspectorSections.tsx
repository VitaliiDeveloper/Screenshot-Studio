// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import type { Background, DesignLayout, Screen } from "@screenshot-studio/core/model";
import {
  artboardTargetStatus,
  type StoreSize,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { editorStore } from "../../lib/editor-store";
import { mutateAndSave, mutateAndScheduleSave } from "../../lib/mutate-and-save";
import { ArtboardTargets } from "../ArtboardTargets";
import { editorUi } from "../editor-ui";
import { ColorField, NumberField, SelectField, TextField } from "../inspector-fields";
import { InspectorSection as Section } from "./InspectorSection";

function editBackground(background: Background) {
  mutateAndScheduleSave(() => editorStore.getState().setBackground(background));
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
  const isExactTarget = status?.kind === "exact";
  const isCustomTarget = Boolean(target) && !isExactTarget;
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
        <span role="group" aria-label="Artboard size mode" className="inline-flex gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            aria-label="Use Store size"
            aria-pressed={Boolean(target) && isExactTarget}
            disabled={!target}
            className={`inline-flex h-6 min-w-12 items-center justify-center rounded-md px-2.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 disabled:pointer-events-none disabled:opacity-50 ${isExactTarget ? "bg-white text-slate-800 shadow-sm" : "text-slate-600 hover:bg-white/60 hover:text-slate-800"}`}
            onClick={() => target && !isExactTarget && resize({ width: target.width, height: target.height })}
          >
            <span className="text-xs leading-none">Store size</span>
          </button>
          <button
            type="button"
            aria-label="Use custom artboard size"
            aria-pressed={isCustomTarget}
            disabled={!target}
            className={`inline-flex h-6 min-w-12 items-center justify-center rounded-md px-2.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 disabled:pointer-events-none disabled:opacity-50 ${isCustomTarget ? "bg-white text-slate-800 shadow-sm" : "text-slate-600 hover:bg-white/60 hover:text-slate-800"}`}
            onClick={() => {
              if (!target) return;
              setWidth(screen.artboard.width);
              setHeight(screen.artboard.height);
              setEditing(true);
            }}
          >
            <span className="text-xs leading-none">Custom</span>
          </button>
        </span>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs font-medium tabular-nums text-slate-700">
        {screen.artboard.width} × {screen.artboard.height} px
      </div>
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
          onCreate={(target) => mutateAndSave(() => editorStore.getState().ensureStoreTargetVariant(target))}
          onRemove={(rootScreenId, targetId) => mutateAndSave(
            () => editorStore.getState().removeStoreTargetVariant(rootScreenId, targetId),
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
            <NumberField label="Angle" value={background.angle} min={0} max={360} integer onChange={(angle) => editBackground({ ...background, angle })} />
          </>
        ) : (
          <>
            <TextField label="Asset URL" value={background.assetUrl} onChange={(assetUrl) => editBackground({ ...background, assetUrl })} />
            <SelectField label="Fit" value={background.fit} options={["cover", "contain"] as const} onChange={(fit) => editBackground({ ...background, fit })} />
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
