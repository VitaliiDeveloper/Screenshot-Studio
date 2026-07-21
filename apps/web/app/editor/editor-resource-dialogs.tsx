// SPDX-License-Identifier: Apache-2.0
"use client";

import type { ResourceDialog } from "../../lib/editor-workspace";
import { AssetPickerDialog } from "../../components/AssetPickerDialog";
import { FontManagerDialog } from "../../components/FontManagerDialog";
import { LocaleManagerDialog } from "../../components/LocaleManagerDialog";
import { TemplateLibraryDialog } from "../../components/TemplateLibraryDialog";
import { ThemeManagerDialog } from "../../components/ThemeManagerDialog";

interface EditorResourceDialogsProps {
  dialog: ResourceDialog | null;
  localeDialogOpen: boolean;
  deviceFrameAssetTarget: { elementId: string; screenId: string } | null;
  cacheImage(assetUrl: string): Promise<boolean>;
  closeDialog(): void;
  closeLocaleDialog(): void;
  clearDeviceFrameAssetTarget(): void;
}

export function EditorResourceDialogs({
  dialog,
  localeDialogOpen,
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
      {dialog === "templates" ? <TemplateLibraryDialog onClose={closeDialog} /> : null}
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
      {dialog === "device-frame-assets" ? (
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
