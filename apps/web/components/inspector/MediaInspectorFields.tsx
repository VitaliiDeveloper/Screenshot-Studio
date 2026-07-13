// SPDX-License-Identifier: Apache-2.0
"use client";

import type { ImageElement, ScreenshotElement } from "@screenshot-studio/core/model";
import type { ElementPatchFor } from "../../lib/editor-store";
import { editorUi } from "../editor-ui";
import { NumberField, SelectField, TextField } from "../inspector-fields";
import { mediaInspectorModel } from "./media-inspector-model";

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
      {showCrop ? (
        <div className="flex flex-col gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Cover crop</p>
          <NumberField label="Focal X %" value={crop.x * 100} min={0} max={100} integer onChange={(x) => onChange({ crop: { ...crop, x: x / 100 } })} />
          <NumberField label="Focal Y %" value={crop.y * 100} min={0} max={100} integer onChange={(y) => onChange({ crop: { ...crop, y: y / 100 } })} />
          <NumberField label="Crop zoom" value={crop.zoom} min={1} max={4} step={0.1} onChange={(zoom) => onChange({ crop: { ...crop, zoom } })} />
          {canResetCrop ? (
            <button type="button" className={editorUi.buttonSecondary} onClick={() => onChange({ crop: null })}>
              Reset crop
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
