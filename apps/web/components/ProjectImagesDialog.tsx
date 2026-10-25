// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import { FolderOpen, ImagePlus, Search, Upload } from "lucide-react";
import { createImageElement } from "@screenshot-studio/core/model";
import { filterProjectImageAssets, type ProjectImageAsset } from "@web/lib/project-assets";
import { editorStore } from "@web/lib/editor/editor-store";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";
import { projectJsonRequest } from "@web/lib/clients/project-api-client";
import { resolveActiveProjectAssetUrl } from "@web/lib/clients/save-project";
import { actionableAssetError } from "./AssetPickerDialog";
import {
  initialMediaElementSize,
  insertAssetAfterCaching,
  type CachedAssetDimensions,
} from "./asset-picker-model";
import { DialogShell, EmptyResourceState, editorUi, StatusMessage } from "./editor-ui";

export function withImportedAsset(
  assets: readonly ProjectImageAsset[],
  asset: ProjectImageAsset,
): ProjectImageAsset[] {
  return [...assets.filter((existing) => existing.path !== asset.path), asset].sort((first, second) => (
    first.path < second.path ? -1 : first.path > second.path ? 1 : 0
  ));
}

export function ProjectImagesDialog({
  cacheAsset,
  onClose,
}: {
  cacheAsset: (path: string) => Promise<CachedAssetDimensions | null>;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<ProjectImageAsset[] | null>(null);
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"importing" | "inserting" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef(true);
  const isCurrent = () => activeRef.current;

  useEffect(() => {
    activeRef.current = true;
    return () => { activeRef.current = false; };
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

  const importImage = async (file: File) => {
    setBusy("importing");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const { body } = await projectJsonRequest<{ asset?: ProjectImageAsset }>("/api/assets", {
        method: "POST",
        conditional: true,
        advanceRevision: true,
        body: form,
        errorFallback: "Image import failed",
      });
      const asset = body.asset;
      if (!asset?.path || !asset.name || asset.source !== "assets") {
        throw new Error("Image import returned an invalid response");
      }
      if (!isCurrent()) return;
      setAssets((current) => withImportedAsset(current ?? [], asset));
      setQuery("");
      setSelectedPath(asset.path);
    } catch (importError) {
      if (isCurrent()) setError(actionableAssetError((importError as Error).message));
    } finally {
      if (isCurrent()) setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const insertSelected = async () => {
    if (!selectedPath) return;
    setBusy("inserting");
    setError(null);
    try {
      await insertAssetAfterCaching(selectedPath, cacheAsset, (path, dimensions) => {
        mutateAndSave(() => editorStore.getState().addElement(
          createImageElement({ assetUrl: path, ...initialMediaElementSize(dimensions) }),
        ));
        onClose();
      }, isCurrent);
    } catch (insertError) {
      if (!isCurrent()) return;
      setError(actionableAssetError((insertError as Error).message));
      setBusy(null);
    }
  };

  return (
    <DialogShell
      title="Project images"
      description="Images stored in this project. Import a PNG, JPEG, or WebP, or insert the selected image on the current screen."
      ariaLabel="Project images"
      closeLabel="Close project images"
      onClose={onClose}
      widthClass="max-w-4xl"
      bodyClassName="flex h-[min(34rem,calc(88vh-8rem))] min-h-0 flex-col"
    >
      <div className="mb-4 flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--editor-color-text-subtle)]" size={15} strokeWidth={1.9} />
          <input
            type="search"
            aria-label="Search project images"
            value={query}
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
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void importImage(file);
          }}
        />
        <button
          type="button"
          className={editorUi.buttonSecondary}
          disabled={busy !== null}
          aria-label="Import image from Finder or device"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={15} strokeWidth={1.9} />
          {busy === "importing" ? "Importing…" : "Import image…"}
        </button>
      </div>

      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {assets === null ? (
          error ? null : <p role="status" className="grid h-full place-items-center text-center text-xs text-[color:var(--editor-color-text-secondary)]">Scanning project images…</p>
        ) : visibleAssets.length === 0 ? (
          <EmptyResourceState
            icon={FolderOpen}
            title={assets.length === 0 ? "No project images found" : "No matching images"}
            description={assets.length === 0
              ? "Import a PNG, JPEG, or WebP from your device. It will be stored in this project."
              : "Try another filename or project path."}
            path="assets/ · screenshots/"
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 p-0.5 sm:grid-cols-3 lg:grid-cols-4">
            {visibleAssets.map((asset) => {
              const selected = asset.path === selectedPath;
              return (
                <button
                  key={asset.path}
                  type="button"
                  aria-label={asset.path}
                  aria-pressed={selected}
                  disabled={busy !== null}
                  className={`group overflow-hidden rounded-xl border bg-[var(--editor-color-surface)] text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] ${selected ? "border-[var(--editor-color-selection)] ring-2 ring-[var(--editor-color-focus)]" : "border-[var(--editor-color-border)] hover:border-[var(--editor-color-accent-border-strong)]"}`}
                  onClick={() => setSelectedPath(asset.path)}
                >
                  <span className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[linear-gradient(45deg,var(--editor-color-surface-muted)_25%,transparent_25%),linear-gradient(-45deg,var(--editor-color-surface-muted)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--editor-color-surface-muted)_75%),linear-gradient(-45deg,transparent_75%,var(--editor-color-surface-muted)_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px]">
                    <NextImage
                      src={resolveActiveProjectAssetUrl(asset.path)}
                      alt=""
                      fill
                      unoptimized
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      loading="lazy"
                      draggable={false}
                      className="size-full object-contain"
                    />
                  </span>
                  <span className="block p-3">
                    <span className="block truncate text-xs font-semibold text-[color:var(--editor-color-text)]">{asset.name}</span>
                    <span className="mt-1 block truncate font-mono text-[10px] text-[color:var(--editor-color-text-subtle)]">{asset.path}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-[var(--editor-color-border)] pt-4">
        <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--editor-color-text-secondary)]">
          {selectedPath ?? "Select an image to insert it on the current screen."}
        </span>
        <button
          type="button"
          className={editorUi.buttonPrimary}
          disabled={!selectedPath || busy !== null}
          onClick={() => { void insertSelected(); }}
        >
          <ImagePlus size={15} strokeWidth={1.9} />
          {busy === "inserting" ? "Inserting…" : "Insert as image"}
        </button>
      </div>
    </DialogShell>
  );
}
