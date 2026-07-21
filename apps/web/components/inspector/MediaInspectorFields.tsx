// SPDX-License-Identifier: Apache-2.0
"use client";

import { MEDIA_BLUR_MAX, type ImageElement, type ScreenshotElement } from "@screenshot-studio/core/model";
import type { ElementPatchFor } from "../../lib/editor-store";
import { editorUi, InsetPanel } from "../editor-ui";
import { NumberField, SelectField, TextField } from "../inspector-fields";
import { mediaInspectorModel } from "./media-inspector-model";
import { OptionalInspectorEffect } from "./OptionalInspectorEffect";

export function MediaInspectorFields({
  element,
  onChange,
}: {
  element: ScreenshotElement | ImageElement;
  onChange: (patch: ElementPatchFor<"screenshot"> | ElementPatchFor<"image">) => void;
}) {
  const { crop, showCrop, canResetCrop } = mediaInspectorModel(element);
  return (
    <>
      <TextField label="Asset URL" value={element.assetUrl} onChange={(assetUrl) => onChange({ assetUrl })} />
      <SelectField label="Fit" value={element.fit} options={["cover", "contain"] as const} onChange={(fit) => onChange({ fit })} />
      <NumberField label="Corner radius" value={element.cornerRadius} min={0} onChange={(cornerRadius) => onChange({ cornerRadius })} />
      <OptionalInspectorEffect
        title="Blur"
        description="Soften the media content"
        enabled={Boolean(element.blur)}
        onAdd={() => onChange({ blur: 8 })}
        onRemove={() => onChange({ blur: null })}
      >
        {element.blur ? (
          <NumberField label="Blur radius" value={element.blur} min={0} max={MEDIA_BLUR_MAX} step={1} onChange={(blur) => onChange({ blur: blur === 0 ? null : blur })} />
        ) : null}
      </OptionalInspectorEffect>
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
