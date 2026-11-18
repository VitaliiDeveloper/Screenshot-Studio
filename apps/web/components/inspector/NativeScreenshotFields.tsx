// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import {
  nativeCroppedSize,
  type NativeInsets,
  type ScreenshotElement,
} from "@screenshot-studio/core/model";
import { nativePlacementMessage, type NativePlacementReason } from "@screenshot-studio/core/validation";
import type { ElementPatchFor } from "@web/lib/editor/editor-store";
import { resolveActiveProjectAssetUrl } from "@web/lib/clients/save-project";
import { NumberField } from "@web/components/inspector/inspector-fields";

const SIDES = [
  { key: "top", label: "Crop top" },
  { key: "bottom", label: "Crop bottom" },
  { key: "left", label: "Crop left" },
  { key: "right", label: "Crop right" },
] as const;

/** Decoded pixel size of a project image; null until it loads or when it fails. */
export function useImageSourceSize(assetUrl: string): { width: number; height: number } | null {
  const [size, setSize] = useState<{ assetUrl: string; width: number; height: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let src: string;
    try {
      src = resolveActiveProjectAssetUrl(assetUrl);
    } catch {
      return;
    }
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setSize({ assetUrl, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [assetUrl]);
  return size?.assetUrl === assetUrl ? { width: size.width, height: size.height } : null;
}

/** Edge insets change the box with them, so the box always equals the cropped source. */
export function nativeInsetsPatch(
  insets: NativeInsets,
  sourceSize: { width: number; height: number } | null,
): ElementPatchFor<"screenshot"> {
  const empty = insets.top === 0 && insets.right === 0 && insets.bottom === 0 && insets.left === 0;
  const cropped = sourceSize ? nativeCroppedSize(sourceSize, insets) : null;
  return {
    nativeInsets: empty ? null : insets,
    ...(cropped && cropped.width > 0 && cropped.height > 0 ? cropped : {}),
  };
}

export function NativeScreenshotFields({
  element,
  sourceSize,
  reasons,
  onChange,
}: {
  element: ScreenshotElement;
  sourceSize: { width: number; height: number } | null;
  /** The live native-placement issue for this layer, from the editor's Issues. */
  reasons: readonly NativePlacementReason[];
  onChange: (patch: ElementPatchFor<"screenshot">) => void;
}) {
  const insets: NativeInsets = { top: 0, right: 0, bottom: 0, left: 0, ...element.nativeInsets };
  const cropped = sourceSize ? nativeCroppedSize(sourceSize, insets) : null;
  return (
    <div className="flex flex-col gap-2 text-xs" data-native-screenshot-fields>
      <p className="leading-5 text-[color:var(--editor-color-text-secondary)]">
        Placed pixel for pixel, never scaled. Export fails if the result differs from the source, so
        use an opaque 8-bit sRGB PNG.
        {cropped ? ` ${cropped.width}×${cropped.height} px after crop.` : null}
      </p>
      {SIDES.map(({ key, label }) => (
        <NumberField
          key={key}
          label={label}
          value={insets[key]}
          min={0}
          integer
          suffix="px"
          onChange={(value) => onChange(nativeInsetsPatch({ ...insets, [key]: Math.max(0, Math.round(value)) }, sourceSize))}
        />
      ))}
      {reasons.length > 0 ? (
        <p
          role="status"
          className="flex gap-1.5 rounded-md border border-[var(--editor-color-warning-border)] bg-[var(--editor-color-warning-surface)] px-2 py-1.5 leading-5 text-[color:var(--editor-color-warning-text)]"
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{nativePlacementMessage(reasons)}.</span>
        </p>
      ) : null}
    </div>
  );
}
