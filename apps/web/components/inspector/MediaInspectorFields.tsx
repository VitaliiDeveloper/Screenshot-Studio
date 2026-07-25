// SPDX-License-Identifier: Apache-2.0
"use client";

import NextImage from "next/image";
import { useState } from "react";
import type { ImageElement, ScreenshotElement } from "@screenshot-studio/core/model";
import { Image as ImageIcon, Trash2 } from "lucide-react";
import { editorStore, type ElementPatchFor } from "@web/lib/editor-store";
import { resolveActiveProjectAssetUrl } from "@web/lib/save-project";
import { editorUi, InsetPanel } from "@web/components/editor-ui";
import { mediaInspectorModel } from "./media-inspector-model";
import { MediaCropControl } from "./MediaCropControl";
import { MediaPresentationFields } from "./MediaPresentationFields";

function assetThumbnailUrl(assetUrl: string): string {
  try {
    return resolveActiveProjectAssetUrl(assetUrl);
  } catch {
    return assetUrl;
  }
}

export function MediaInspectorFields({
  element,
  onChange,
  onChooseAsset,
  onRemoveElement,
  effectiveLocked: effectiveLockedProp,
}: {
  element: ScreenshotElement | ImageElement;
  onChange: (patch: ElementPatchFor<"screenshot"> | ElementPatchFor<"image">) => void;
  onChooseAsset?: () => void;
  onRemoveElement?: () => void;
  effectiveLocked?: boolean;
}) {
  const { crop, showCrop, canResetCrop } = mediaInspectorModel(element);
  const effectiveLocked = effectiveLockedProp ?? element.locked;
  const [failedThumbnailUrl, setFailedThumbnailUrl] = useState<string | null>(null);
  const showThumbnail = failedThumbnailUrl !== element.assetUrl;
  return (
    <>
      <InsetPanel>
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            data-inspector-asset-thumbnail={element.assetUrl}
            className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--editor-color-surface)] text-[color:var(--editor-color-text-secondary)] ring-1 ring-[var(--editor-color-border)]"
          >
            {showThumbnail ? (
              <NextImage
                fill
                unoptimized
                src={assetThumbnailUrl(element.assetUrl)}
                alt=""
                aria-hidden="true"
                sizes="36px"
                className="pointer-events-none select-none object-cover"
                onError={() => setFailedThumbnailUrl(element.assetUrl)}
              />
            ) : (
              <ImageIcon size={17} strokeWidth={1.8} aria-hidden="true" />
            )}
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
        <MediaCropControl
          assetUrl={element.assetUrl}
          crop={crop}
          canReset={canResetCrop}
          locked={effectiveLocked}
          onChange={(nextCrop) => onChange({ crop: nextCrop })}
          onReset={() => onChange({ crop: null })}
          onInteractionEnd={() => editorStore.getState().endHistoryGroup()}
        />
      ) : null}
    </>
  );
}
