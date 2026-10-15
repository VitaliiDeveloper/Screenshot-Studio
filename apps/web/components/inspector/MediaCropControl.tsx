// SPDX-License-Identifier: Apache-2.0
"use client";

import NextImage from "next/image";
import type { KeyboardEvent, PointerEvent } from "react";
import { Minus, Plus } from "lucide-react";
import type { MediaCrop } from "@screenshot-studio/core/model";
import { editorUi, InsetPanel } from "@web/components/editor-ui";
import { NumberField, rangeProgressStyle } from "@web/components/inspector-fields";
import { resolveActiveProjectAssetUrl } from "@web/lib/save-project";
import {
  adjustCropZoom,
  cropFromPointer,
  directCropPatch,
  nudgeCrop,
} from "./media-inspector-model";
import { InspectorDisclosure } from "./InspectorDisclosure";

function thumbnailUrl(assetUrl: string): string {
  try {
    return resolveActiveProjectAssetUrl(assetUrl);
  } catch {
    return assetUrl;
  }
}

export function MediaCropControl({
  assetUrl,
  crop,
  canReset,
  locked,
  onChange,
  onReset,
  onInteractionEnd,
}: {
  assetUrl: string;
  crop: MediaCrop;
  canReset: boolean;
  locked: boolean;
  onChange: (crop: MediaCrop) => void;
  onReset: () => void;
  onInteractionEnd: () => void;
}) {
  const updateFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const patch = directCropPatch(locked, cropFromPointer(
      { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      { width: bounds.width, height: bounds.height },
      crop.zoom,
    ));
    if (patch) onChange(patch);
  };
  const handleFocalKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === "Home"
      ? { ...crop, x: 0.5, y: 0.5 }
      : nudgeCrop(crop, event.key, event.shiftKey);
    const patch = next === crop ? null : directCropPatch(locked, next);
    if (!patch) return;
    event.preventDefault();
    onChange(patch);
    onInteractionEnd();
  };
  const changeZoom = (delta: number) => {
    const patch = directCropPatch(locked, adjustCropZoom(crop, delta));
    if (!patch) return;
    onChange(patch);
    onInteractionEnd();
  };
  const updateZoom = (zoom: number) => {
    const patch = directCropPatch(locked, { ...crop, zoom });
    if (patch) onChange(patch);
  };

  return (
    <InsetPanel>
      <div>
        <p className={editorUi.sectionLabel}>Cover crop</p>
        <p className="mt-1 text-[10px] leading-4 text-[color:var(--editor-color-text-secondary)]">
          Drag the focal point to reposition. Zoom to adjust the crop.
        </p>
      </div>

      <div className="relative aspect-[3/2] overflow-hidden rounded-[var(--editor-radius-control)] bg-[var(--editor-color-surface-muted)] ring-1 ring-[var(--editor-color-border)]">
        <NextImage
          fill
          unoptimized
          src={thumbnailUrl(assetUrl)}
          alt=""
          aria-hidden="true"
          sizes="256px"
          className="pointer-events-none select-none object-cover"
          style={{
            objectPosition: `${crop.x * 100}% ${crop.y * 100}%`,
            transform: `scale(${crop.zoom})`,
            transformOrigin: `${crop.x * 100}% ${crop.y * 100}%`,
          }}
        />
        <span className="pointer-events-none absolute inset-2 rounded-[var(--editor-radius-compact)] border border-[var(--editor-color-on-media-muted)] shadow-[var(--editor-shadow-media-outline)]" />
        <button
          type="button"
          aria-label="Focal point"
          disabled={locked}
          className="absolute inset-0 cursor-crosshair focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--editor-color-focus)] disabled:cursor-not-allowed"
          onPointerDown={(event) => {
            if (locked) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            updateFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            onInteractionEnd();
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            onInteractionEnd();
          }}
          onKeyDown={handleFocalKey}
          onBlur={onInteractionEnd}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--editor-color-on-media)] bg-[var(--editor-color-accent)] shadow-[var(--editor-shadow-control)]"
            style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%` }}
          />
        </button>
      </div>

      <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem_2.5rem] items-center gap-2">
        <button
          type="button"
          aria-label="Decrease crop zoom"
          className={editorUi.compactIconButton}
          disabled={locked || crop.zoom <= 1}
          onClick={() => changeZoom(-0.1)}
        >
          <Minus size={13} aria-hidden="true" />
        </button>
        <input
          type="range"
          aria-label="Crop zoom"
          min={1}
          max={4}
          step={0.1}
          value={crop.zoom}
          disabled={locked}
          className={editorUi.rangeInput}
          style={rangeProgressStyle(crop.zoom, 1, 4)}
          onChange={(event) => updateZoom(Number(event.currentTarget.value))}
          onPointerUp={onInteractionEnd}
          onKeyUp={onInteractionEnd}
          onBlur={onInteractionEnd}
        />
        <button
          type="button"
          aria-label="Increase crop zoom"
          className={editorUi.compactIconButton}
          disabled={locked || crop.zoom >= 4}
          onClick={() => changeZoom(0.1)}
        >
          <Plus size={13} aria-hidden="true" />
        </button>
        <span className="text-right text-xs tabular-nums text-[color:var(--editor-color-text-default)]">
          {crop.zoom.toFixed(1).replace(/\.0$/, "")}x
        </span>
      </div>

      <button
        type="button"
        className={editorUi.buttonSecondary}
        disabled={locked || !canReset}
        onClick={() => {
          if (!locked) onReset();
        }}
      >
        Reset crop
      </button>

      <InspectorDisclosure label="Advanced" contentId="advanced-crop-position">
        <NumberField
          label="Focal X %"
          value={crop.x * 100}
          min={0}
          max={100}
          integer
          suffix="%"
          onChange={(x) => onChange({ ...crop, x: x / 100 })}
        />
        <NumberField
          label="Focal Y %"
          value={crop.y * 100}
          min={0}
          max={100}
          integer
          suffix="%"
          onChange={(y) => onChange({ ...crop, y: y / 100 })}
        />
      </InspectorDisclosure>
    </InsetPanel>
  );
}
