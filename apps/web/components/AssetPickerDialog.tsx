// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useMemo, useState } from "react";
import NextImage from "next/image";
import { FolderOpen, Image as ImageIcon, Search, Smartphone } from "lucide-react";
import {
  createDeviceFrameElement,
  createImageElement,
  createScreenshotElement,
} from "@screenshot-studio/core/model";
import {
  filterProjectImageAssets,
  type ProjectImageAsset,
} from "../lib/project-assets";
import { editorStore } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { DialogShell, EmptyResourceState, editorUi, StatusMessage } from "./editor-ui";

type AssetElementType = "screenshot" | "image" | "background" | "store-badge" | "device-frame";

function assetUrl(path: string): string {
  return `/api/asset?path=${encodeURIComponent(path)}`;
}

export function AssetPickerDialog({
  elementType,
  onClose,
}: {
  elementType: AssetElementType;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<ProjectImageAsset[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/assets")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? `Asset listing failed (${response.status})`);
        if (!Array.isArray(body.assets)) throw new Error("Asset listing returned an invalid response");
        if (!cancelled) setAssets(body.assets as ProjectImageAsset[]);
      })
      .catch((loadError) => {
        if (!cancelled) setError((loadError as Error).message);
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
  const insert = (path: string) => {
    if (isBackground) {
      mutateAndSave(() => editorStore.getState().setBackground({
        type: "image",
        assetUrl: path,
        fit: "cover",
        color: "#000000",
      }));
      onClose();
      return;
    }
    const element = isFrame
      ? createDeviceFrameElement({ assetUrl: path })
      : isStoreBadge
        ? { ...createImageElement({ assetUrl: path, width: 420, height: 140 }), name: "Store badge" }
        : isImage
          ? createImageElement({ assetUrl: path })
          : createScreenshotElement({ assetUrl: path });
    mutateAndSave(() => editorStore.getState().addElement(element));
    onClose();
  };

  return (
    <DialogShell
      title={isFrame ? "Choose device screenshot" : isBackground ? "Choose background image" : isStoreBadge ? "Choose store badge asset" : isImage ? "Choose decorative image" : "Choose screenshot asset"}
      description={isFrame
        ? "Place a project image inside a deterministic built-in device frame."
        : isBackground
          ? "Use an existing project image as this output's artboard background."
        : isStoreBadge
          ? "Insert an official store badge image from this project."
          : isImage
          ? "Insert an existing project asset as a decorative image element."
          : "Insert an existing project image as a screenshot element."}
      ariaLabel={isFrame ? "Device frame asset picker" : isBackground ? "Background asset picker" : isStoreBadge ? "Store badge asset picker" : isImage ? "Image asset picker" : "Screenshot asset picker"}
      closeLabel="Close asset picker"
      onClose={onClose}
      widthClass="max-w-4xl"
      bodyClassName="flex min-h-0 flex-col"
    >
      <label className="relative mb-4 block">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} strokeWidth={1.9} />
        <input
          type="search"
          aria-label="Search project assets"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search assets and source screenshots…"
          className={`${editorUi.field} pl-9`}
        />
      </label>

      {error ? (
        <StatusMessage tone="error">{error}</StatusMessage>
      ) : assets === null ? (
        <p role="status" className="py-12 text-center text-xs text-slate-500">Scanning project images…</p>
      ) : visibleAssets.length === 0 ? (
        <EmptyResourceState
          icon={FolderOpen}
          title={assets.length === 0 ? "No project images found" : "No matching images"}
          description={assets.length === 0
            ? "Add PNG, JPEG, or WebP files under assets/ or screenshots/."
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
              className="group overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
              onClick={() => insert(asset.path)}
            >
              <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[linear-gradient(45deg,#f8fafc_25%,transparent_25%),linear-gradient(-45deg,#f8fafc_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f8fafc_75%),linear-gradient(-45deg,transparent_75%,#f8fafc_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px]">
                <NextImage
                  src={assetUrl(asset.path)}
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
