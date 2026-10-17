// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import { FolderOpen, Image as ImageIcon, Search, Smartphone, Upload } from "lucide-react";
import {
  createDeviceFrameElement,
  createImageElement,
  createScreenshotElement,
} from "@screenshot-studio/core/model";
import {
  filterProjectImageAssets,
  type ProjectImageAsset,
} from "@web/lib/project-assets";
import { editorStore } from "@web/lib/editor/editor-store";
import {
  defaultDeviceFrameInputForScreen,
  type MediaAssetTarget,
} from "@web/lib/editor/editor-workspace";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";
import { projectJsonRequest } from "@web/lib/clients/project-api-client";
import { resolveActiveProjectAssetUrl } from "@web/lib/clients/save-project";
import {
  initialMediaElementSize,
  insertAssetAfterCaching,
  type CachedAssetDimensions,
} from "./asset-picker-model";
import { DialogShell, EmptyResourceState, editorUi, StatusMessage } from "./editor-ui";
import { DIALOG_EXIT_DURATION_MS } from "./editor-ui/DialogShell";

type AssetElementType = "screenshot" | "image" | "background" | "store-badge" | "device-frame";

function actionableAssetError(message: string): string {
  if (/unable to reopen the managed project/i.test(message)) {
    return "This project session is no longer connected to its managed files. Reopen the project from Projects, then choose or import an image.";
  }
  if (/active project changed|project identity is unavailable/i.test(message)) {
    return "The active project changed. Reopen this project before choosing or importing an image.";
  }
  return message;
}

export function AssetPickerDialog({
  elementType,
  targetDeviceFrame,
  targetMedia,
  cacheAsset,
  onClose,
}: {
  elementType: AssetElementType;
  targetDeviceFrame?: { elementId: string; screenId: string };
  targetMedia?: MediaAssetTarget;
  cacheAsset: (path: string) => Promise<CachedAssetDimensions | null>;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<ProjectImageAsset[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dialogMotion, setDialogMotion] = useState<"open" | "closing">("open");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef(true);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void projectJsonRequest<{ assets?: unknown }>("/api/assets", {
      errorFallback: "Asset listing failed",
    })
      .then(({ body }) => {
        if (!Array.isArray(body.assets)) throw new Error("Asset listing returned an invalid response");
        if (!cancelled) setAssets(body.assets as ProjectImageAsset[]);
      })
      .catch((loadError) => {
        if (!cancelled) setError(actionableAssetError((loadError as Error).message));
      });
    return () => { cancelled = true; };
  }, []);

  const visibleAssets = useMemo(
    () => filterProjectImageAssets(assets ?? [], query),
    [assets, query],
  );
  const isFrame = elementType === "device-frame";
  const isImage = elementType === "image";
  const isBackground = elementType === "background";
  const isStoreBadge = elementType === "store-badge";
  const isClosing = dialogMotion === "closing";
  const isCurrent = () => activeRef.current && !closingRef.current;
  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onCloseRef.current();
      return;
    }
    setDialogMotion("closing");
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onCloseRef.current();
    }, DIALOG_EXIT_DURATION_MS);
  };
  const insert = (path: string, dimensions: CachedAssetDimensions) => {
    if (!isCurrent()) return;
    if (targetMedia) {
      mutateAndSave(() => editorStore.getState().patchElement({
        id: targetMedia.elementId,
        screenId: targetMedia.screenId,
        type: targetMedia.elementType,
        patch: { assetUrl: path },
      }));
      requestClose();
      return;
    }
    if (isBackground) {
      mutateAndSave(() => editorStore.getState().setBackground({
        type: "image",
        assetUrl: path,
        fit: "cover",
        color: "#000000",
      }));
      requestClose();
      return;
    }
    if (isFrame && targetDeviceFrame) {
      mutateAndSave(() => editorStore.getState().patchElement({
        id: targetDeviceFrame.elementId,
        screenId: targetDeviceFrame.screenId,
        type: "device-frame",
        patch: { assetUrl: path },
      }));
      requestClose();
      return;
    }
    const { project, activeLayoutId, activeScreenId } = editorStore.getState();
    const activeScreen = project?.layouts.find((layout) => layout.id === activeLayoutId)?.screens
      .find((screen) => screen.id === activeScreenId);
    const element = isFrame
      ? createDeviceFrameElement({
        ...defaultDeviceFrameInputForScreen(activeScreen),
        assetUrl: path,
      })
      : isStoreBadge
        ? { ...createImageElement({ assetUrl: path, width: 420, height: 140 }), name: "Store badge" }
        : isImage
          ? createImageElement({ assetUrl: path, ...initialMediaElementSize(dimensions) })
          : createScreenshotElement({ assetUrl: path, ...initialMediaElementSize(dimensions) });
    mutateAndSave(() => editorStore.getState().addElement(element));
    requestClose();
  };

  const cacheAndInsert = async (path: string) => {
    if (!isCurrent()) return;
    setUploading(true);
    setError(null);
    try {
      await insertAssetAfterCaching(path, cacheAsset, insert, isCurrent);
    } catch (loadError) {
      if (!isCurrent()) return;
      setError(actionableAssetError((loadError as Error).message));
      setUploading(false);
    }
  };

  const importAndInsert = async (file: File) => {
    if (!isCurrent()) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const { body } = await projectJsonRequest<{
        asset?: ProjectImageAsset;
        error?: string;
      }>("/api/assets", {
        method: "POST",
        conditional: true,
        advanceRevision: true,
        body: form,
        errorFallback: "Image import failed",
      });
      if (!body.asset?.path || !body.asset.name || body.asset.source !== "assets") {
        throw new Error("Image import returned an invalid response");
      }
      if (!isCurrent()) return;
      setAssets((current) => [...(current ?? []), body.asset!].sort((first, second) => (
        first.path < second.path ? -1 : first.path > second.path ? 1 : 0
      )));
      await insertAssetAfterCaching(
        body.asset.path,
        cacheAsset,
        insert,
        isCurrent,
      );
    } catch (uploadError) {
      if (!isCurrent()) return;
      setError(actionableAssetError((uploadError as Error).message));
      setUploading(false);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <DialogShell
      title={isFrame ? "Choose device screenshot" : isBackground ? "Choose background image" : isStoreBadge ? "Choose store badge asset" : isImage ? "Choose decorative image" : "Choose screenshot asset"}
      description={isFrame
        ? targetDeviceFrame
          ? "Choose a project image, or import one from your device and use it in this mockup immediately."
          : "Choose a project image, or import one from your device and place it inside a deterministic built-in frame."
        : isBackground
          ? "Choose a project image, or import one and use it as this output's artboard background."
        : isStoreBadge
          ? "Choose an official store badge image from this project, or import one from your device."
          : isImage
          ? "Choose a project asset, or import one and use it as a decorative image immediately."
          : "Choose a project image, or import one and use it as a screenshot immediately."}
      ariaLabel={isFrame ? "Mockup screenshot picker" : isBackground ? "Background asset picker" : isStoreBadge ? "Store badge asset picker" : isImage ? "Image asset picker" : "Screenshot asset picker"}
      closeLabel="Close asset picker"
      onClose={requestClose}
      widthClass="max-w-4xl"
      bodyClassName="flex h-[min(34rem,calc(88vh-8rem))] min-h-0 flex-col"
      motion={dialogMotion}
    >
      <div className="mb-4 flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} strokeWidth={1.9} />
          <input
            type="search"
            aria-label="Search project assets"
            value={query}
            disabled={isClosing}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search project images…"
            className={`${editorUi.field} pl-9`}
          />
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          className="sr-only"
          aria-label="Choose image from device"
          disabled={isClosing}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void importAndInsert(file);
          }}
        />
        <button
          type="button"
          className={editorUi.buttonSecondary}
          disabled={uploading || isClosing}
          aria-label="Import image from Finder or device"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={15} strokeWidth={1.9} />
          {uploading ? "Importing…" : "Import image…"}
        </button>
      </div>

      {error ? (
        <StatusMessage tone="error">{error}</StatusMessage>
      ) : assets === null ? (
        <p role="status" className="grid flex-1 place-items-center text-center text-xs text-slate-500">Scanning project images…</p>
      ) : visibleAssets.length === 0 ? (
        <EmptyResourceState
          icon={FolderOpen}
          title={assets.length === 0 ? "No project images found" : "No matching images"}
          description={assets.length === 0
            ? "Import a PNG, JPEG, or WebP from your device. It will be stored in this project and used immediately."
            : "Try another filename or project path."}
          path="assets/ · screenshots/"
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visibleAssets.map((asset) => (
            <button
              key={asset.path}
              type="button"
              aria-label={`Use ${asset.path}`}
              disabled={uploading || isClosing}
              className="group overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
              onClick={() => { void cacheAndInsert(asset.path); }}
            >
              <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[linear-gradient(45deg,#f8fafc_25%,transparent_25%),linear-gradient(-45deg,#f8fafc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f8fafc_75%),linear-gradient(-45deg,transparent_75%,#f8fafc_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px]">
                <NextImage
                  src={resolveActiveProjectAssetUrl(asset.path)}
                  alt=""
                  fill
                  unoptimized
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  loading="lazy"
                  draggable={false}
                  className="size-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                />
                <span className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-lg bg-white/90 text-slate-600 shadow-sm backdrop-blur">
                  {isFrame ? <Smartphone size={14} strokeWidth={1.8} /> : <ImageIcon size={14} strokeWidth={1.8} />}
                </span>
              </span>
              <span className="block p-3">
                <span className="block truncate text-xs font-semibold text-slate-800">{asset.name}</span>
                <span className="mt-1 block truncate font-mono text-[10px] text-slate-400">{asset.path}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </DialogShell>
  );
}
