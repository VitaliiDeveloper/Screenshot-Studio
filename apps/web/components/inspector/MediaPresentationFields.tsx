// SPDX-License-Identifier: Apache-2.0
"use client";

import { Maximize2, Minimize2, Scan } from "lucide-react";
import {
  MEDIA_BLUR_MAX,
  type ImageElement,
  type ScreenshotElement,
} from "@screenshot-studio/core/model";
import type { ElementPatchFor } from "@web/lib/editor/editor-store";
import { SegmentedControl } from "@web/components/editor-ui";
import { NumberField } from "@web/components/inspector/inspector-fields";
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

type ContentMode = ScreenshotElement["fit"];

export function ContentModeControl<T extends ContentMode>({
  value,
  onChange,
  allowNative = false,
}: {
  value: T;
  onChange: (fit: T) => void;
  /** Offer `1:1` (native pixels); only Screenshot layers support it. */
  allowNative?: boolean;
}) {
  const options = [
    { value: "cover", label: <><Maximize2 size={13} aria-hidden="true" /> Fill</> },
    { value: "contain", label: <><Minimize2 size={13} aria-hidden="true" /> Fit</> },
    ...(allowNative ? [{ value: "native", label: <><Scan size={13} aria-hidden="true" /> 1:1</> }] : []),
  ] as Array<{ value: T; label: React.ReactNode }>;
  return (
    <div className="flex flex-col gap-2 text-xs">
      <span className="text-[color:var(--editor-color-text-secondary)]">Content mode</span>
      <SegmentedControl
        label="Content mode"
        value={value}
        fill
        options={options}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * Entering 1:1 sizes the box to the source and clears everything that would alter its pixels; the
 * remaining placement rules are reported as Issues.
 */
export function nativeModePatch(
  element: Pick<ScreenshotElement, "x" | "y">,
  sourceSize: { width: number; height: number } | null,
): ElementPatchFor<"screenshot"> {
  return {
    fit: "native",
    x: Math.round(element.x),
    y: Math.round(element.y),
    rotation: 0,
    opacity: 1,
    cornerRadius: 0,
    blur: null,
    crop: null,
    nativeInsets: null,
    ...(sourceSize ? { width: sourceSize.width, height: sourceSize.height } : {}),
  };
}

export function MediaPresentationFields({
  element,
  onChange,
  sourceSize = null,
}: {
  element: ScreenshotElement | ImageElement;
  onChange: (patch: ElementPatchFor<"screenshot"> | ElementPatchFor<"image">) => void;
  /** Decoded source size, used to size the box when entering 1:1. */
  sourceSize?: { width: number; height: number } | null;
}) {
  const radiusMode = cornerRadiusMode(element.cornerRadius, element);
  const contentMode = element.type === "screenshot" ? (
    <ContentModeControl
      value={element.fit}
      allowNative
      onChange={(fit) => onChange(fit === "native" ? nativeModePatch(element, sourceSize) : { fit })}
    />
  ) : (
    <ContentModeControl value={element.fit} onChange={(fit) => onChange({ fit })} />
  );
  // Radius and blur always change pixels, so 1:1 hides them.
  if (element.fit === "native") return contentMode;

  return (
    <>
      {contentMode}

      <div className="flex flex-col gap-2 text-xs">
        <span className="text-[color:var(--editor-color-text-secondary)]">Corner radius</span>
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
