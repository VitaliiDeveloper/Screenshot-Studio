// SPDX-License-Identifier: Apache-2.0
"use client";

import type { MediaAssetTarget, ResourceDialog } from "@web/lib/editor-workspace";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { AssetPickerDialog } from "@web/components/AssetPickerDialog";
import { FontManagerDialog } from "@web/components/FontManagerDialog";
import { LocaleManagerDialog } from "@web/components/LocaleManagerDialog";
import { TemplateLibraryDialog } from "@web/components/TemplateLibraryDialog";
import { ThemeManagerDialog } from "@web/components/ThemeManagerDialog";
import type { CachedAssetDimensions } from "@web/components/asset-picker-model";

interface EditorResourceDialogsProps {
  dialog: ResourceDialog | null;
  localeDialogOpen: boolean;
  specs: StoreSpecs;
  deviceFrameAssetTarget: { elementId: string; screenId: string } | null;
  mediaAssetTarget: MediaAssetTarget | null;
  cacheImage(assetUrl: string): Promise<CachedAssetDimensions | null>;
  closeDialog(): void;
  closeLocaleDialog(): void;
  clearDeviceFrameAssetTarget(): void;
  clearMediaAssetTarget(): void;
}

export function EditorResourceDialogs({
  dialog,
  localeDialogOpen,
  specs,
  deviceFrameAssetTarget,
  mediaAssetTarget,
  cacheImage,
  closeDialog,
  closeLocaleDialog,
  clearDeviceFrameAssetTarget,
  clearMediaAssetTarget,
}: EditorResourceDialogsProps) {
  return (
    <>
      <FontManagerDialog open={dialog === "fonts"} onClose={closeDialog} />
      {dialog === "themes" ? <ThemeManagerDialog onClose={closeDialog} /> : null}
      {dialog === "templates" ? <TemplateLibraryDialog specs={specs} onClose={closeDialog} /> : null}
      {dialog === "screenshot-assets" ? (
        <AssetPickerDialog elementType="screenshot" cacheAsset={cacheImage} onClose={closeDialog} />
      ) : null}
      {dialog === "image-assets" ? (
        <AssetPickerDialog elementType="image" cacheAsset={cacheImage} onClose={closeDialog} />
      ) : null}
      {dialog === "background-assets" ? (
        <AssetPickerDialog elementType="background" cacheAsset={cacheImage} onClose={closeDialog} />
      ) : null}
      {dialog === "store-badge-assets" ? (
        <AssetPickerDialog elementType="store-badge" cacheAsset={cacheImage} onClose={closeDialog} />
      ) : null}
      {dialog === "mockup-screenshot-assets" ? (
        <AssetPickerDialog
          elementType="device-frame"
          targetDeviceFrame={deviceFrameAssetTarget ?? undefined}
          cacheAsset={cacheImage}
          onClose={() => {
            closeDialog();
            clearDeviceFrameAssetTarget();
          }}
        />
      ) : null}
      {dialog === "replace-media-asset" && mediaAssetTarget ? (
        <AssetPickerDialog
          elementType={mediaAssetTarget.elementType}
          targetMedia={mediaAssetTarget}
          cacheAsset={cacheImage}
          onClose={() => {
            closeDialog();
            clearMediaAssetTarget();
          }}
        />
      ) : null}
      {localeDialogOpen ? <LocaleManagerDialog onClose={closeLocaleDialog} /> : null}
    </>
  );
}
