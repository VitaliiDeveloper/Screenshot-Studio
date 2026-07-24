// SPDX-License-Identifier: Apache-2.0
"use client";

import type { ResourceDialog } from "@web/lib/editor-workspace";
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
  cacheImage(assetUrl: string): Promise<CachedAssetDimensions | null>;
  closeDialog(): void;
  closeLocaleDialog(): void;
  clearDeviceFrameAssetTarget(): void;
}

export function EditorResourceDialogs({
  dialog,
  localeDialogOpen,
  specs,
  deviceFrameAssetTarget,
  cacheImage,
  closeDialog,
  closeLocaleDialog,
  clearDeviceFrameAssetTarget,
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
      {localeDialogOpen ? <LocaleManagerDialog onClose={closeLocaleDialog} /> : null}
    </>
  );
}
