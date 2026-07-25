// SPDX-License-Identifier: Apache-2.0
"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import {
  MEDIA_BLUR_MAX,
  type ImageElement,
  type ScreenshotElement,
} from "@screenshot-studio/core/model";
import type { ElementPatchFor } from "@web/lib/editor-store";
import { SegmentedControl } from "@web/components/editor-ui";
import { NumberField } from "@web/components/inspector-fields";
import { OptionalInspectorEffect } from "./OptionalInspectorEffect";

export type CornerRadiusMode = "square" | "soft" | "round";

export function cornerRadiusMode(
  radius: number,
  size: { width: number; height: number },
): CornerRadiusMode {
  const round = Math.min(size.width, size.height) / 2;
  if (radius <= 0) return "square";
  return radius >= round ? "round" : "soft";
}

export function cornerRadiusPresetValue(
  mode: CornerRadiusMode,
  size: { width: number; height: number },
): number {
  const shortestSide = Math.min(size.width, size.height);
  if (mode === "square") return 0;
  if (mode === "soft") return Math.round(shortestSide * 0.1);
  return Math.round(shortestSide / 2);
}

export function ContentModeControl({
  value,
  onChange,
}: {
  value: ScreenshotElement["fit"];
  onChange: (fit: ScreenshotElement["fit"]) => void;
}) {
  return (
    <div className="flex flex-col gap-2 text-xs">
      <span className="text-slate-500">Content mode</span>
      <SegmentedControl
        label="Content mode"
        value={value}
        fill
        options={[
          {
            value: "cover",
            label: <><Maximize2 size={13} aria-hidden="true" /> Fill</>,
          },
          {
            value: "contain",
            label: <><Minimize2 size={13} aria-hidden="true" /> Fit</>,
          },
        ] as const}
        onChange={onChange}
      />
    </div>
  );
}

export function MediaPresentationFields({
  element,
  onChange,
}: {
  element: ScreenshotElement | ImageElement;
  onChange: (patch: ElementPatchFor<"screenshot"> | ElementPatchFor<"image">) => void;
}) {
  const radiusMode = cornerRadiusMode(element.cornerRadius, element);

  return (
    <>
      <ContentModeControl value={element.fit} onChange={(fit) => onChange({ fit })} />

      <div className="flex flex-col gap-2 text-xs">
        <span className="text-slate-500">Corner radius</span>
        <SegmentedControl
          label="Corner radius preset"
          value={radiusMode}
          fill
          options={[
            { value: "square", label: "Square" },
            { value: "soft", label: "Soft" },
            { value: "round", label: "Round" },
          ] as const}
          onChange={(mode) => onChange({
            cornerRadius: cornerRadiusPresetValue(mode, element),
          })}
        />
        <NumberField
          label="Exact value"
          value={element.cornerRadius}
          min={0}
          step={0.01}
          precision={2}
          suffix="px"
          onChange={(cornerRadius) => onChange({ cornerRadius })}
        />
      </div>

      <OptionalInspectorEffect
        title="Blur"
        description="Soften the media content"
        enabled={Boolean(element.blur)}
        onAdd={() => onChange({ blur: 8 })}
        onRemove={() => onChange({ blur: null })}
      >
        {element.blur ? (
          <NumberField
            label="Blur radius"
            value={element.blur}
            min={0}
            max={MEDIA_BLUR_MAX}
            step={1}
            suffix="px"
            onChange={(blur) => onChange({ blur: blur === 0 ? null : blur })}
          />
        ) : null}
      </OptionalInspectorEffect>
    </>
  );
}
