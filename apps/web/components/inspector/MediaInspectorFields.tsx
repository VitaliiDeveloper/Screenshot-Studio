// SPDX-License-Identifier: Apache-2.0
"use client";

import type { ImageElement, ScreenshotElement } from "@screenshot-studio/core/model";
import { Image as ImageIcon, Trash2 } from "lucide-react";
import type { ElementPatchFor } from "@web/lib/editor-store";
import { editorUi, InsetPanel } from "@web/components/editor-ui";
import { NumberField } from "@web/components/inspector-fields";
import { mediaInspectorModel } from "./media-inspector-model";
import { MediaPresentationFields } from "./MediaPresentationFields";

export function MediaInspectorFields({
  element,
  onChange,
  onChooseAsset,
  onRemoveElement,
}: {
  element: ScreenshotElement | ImageElement;
  onChange: (patch: ElementPatchFor<"screenshot"> | ElementPatchFor<"image">) => void;
  onChooseAsset?: () => void;
  onRemoveElement?: () => void;
}) {
  const { crop, showCrop, canResetCrop } = mediaInspectorModel(element);
  return (
    <>
      <InsetPanel>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--editor-color-surface)] text-[color:var(--editor-color-text-secondary)] ring-1 ring-[var(--editor-color-border)]">
            <ImageIcon size={17} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-[color:var(--editor-color-text-strong)]" title={element.assetUrl}>
              {element.assetUrl.split("/").at(-1)}
            </span>
            <span className="mt-0.5 block text-[10px] leading-4 text-[color:var(--editor-color-text-muted)]">
              Project {element.type === "screenshot" ? "screenshot" : "image"}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`${editorUi.buttonSecondary} min-w-0 flex-1 !text-[13px]`}
            onClick={onChooseAsset}
          >
            Replace
          </button>
          <button
            type="button"
            className={editorUi.iconButtonDanger}
            aria-label={`Remove ${element.type} element`}
            title={`Remove ${element.type}`}
            onClick={onRemoveElement}
          >
            <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </InsetPanel>
      <MediaPresentationFields element={element} onChange={onChange} />
      {showCrop ? (
        <InsetPanel>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Cover crop</p>
          <NumberField label="Focal X %" value={crop.x * 100} min={0} max={100} integer onChange={(x) => onChange({ crop: { ...crop, x: x / 100 } })} />
          <NumberField label="Focal Y %" value={crop.y * 100} min={0} max={100} integer onChange={(y) => onChange({ crop: { ...crop, y: y / 100 } })} />
          <NumberField label="Crop zoom" value={crop.zoom} min={1} max={4} step={0.1} onChange={(zoom) => onChange({ crop: { ...crop, zoom } })} />
          {canResetCrop ? (
            <button type="button" className={editorUi.buttonSecondary} onClick={() => onChange({ crop: null })}>
              Reset crop
            </button>
          ) : null}
        </InsetPanel>
      ) : null}
    </>
  );
}
