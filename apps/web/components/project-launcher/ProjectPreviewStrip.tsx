// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useCallback, useEffect, useState } from "react";
import { loadProjectImages, type ImageCache } from "@screenshot-studio/core/assets";
import type { Project } from "@screenshot-studio/core/model";
import type { ProjectLibraryEntry } from "@web/lib/clients/project-library-client";
import { projectLibraryAssetUrl } from "@web/lib/clients/project-library-client";
import { ScreenThumbnail } from "@web/components/ScreenThumbnail";

export function ProjectPreviewStrip({ entry }: { entry: ProjectLibraryEntry }) {
  const screenIdsKey = entry.previewScreenIds.join("\u0000");
  const previewIdentity = `${entry.entryId}\u0000${entry.lastOpenedAt}\u0000${entry.previewLayoutId ?? ""}\u0000${screenIdsKey}`;
  const [preview, setPreview] = useState<{
    entryId: string;
    layoutId: string;
    project: Project;
    screenIdsKey: string;
    images: ImageCache | null;
    failed: boolean;
  } | null>(null);
  const [readyScreens, setReadyScreens] = useState<{
    identity: string;
    screenIds: readonly string[];
  }>({ identity: previewIdentity, screenIds: [] });

  const markScreenReady = useCallback((screenId: string) => {
    setReadyScreens((current) => {
      const screenIds = current.identity === previewIdentity ? current.screenIds : [];
      if (screenIds.includes(screenId)) return current;
      return { identity: previewIdentity, screenIds: [...screenIds, screenId] };
    });
  }, [previewIdentity]);

  useEffect(() => {
    let active = true;
    if (!entry.previewProject || !entry.previewLayoutId || entry.previewScreenIds.length === 0) return;
    const project = entry.previewProject;
    const layoutId = entry.previewLayoutId;
    void loadProjectImages(
      project,
      layoutId,
      (path) => projectLibraryAssetUrl(entry.entryId, path),
      entry.previewScreenIds,
    ).then((loaded) => {
      if (active) {
        setPreview({
          entryId: entry.entryId,
          layoutId,
          project,
          screenIdsKey,
          images: loaded,
          failed: false,
        });
      }
    }).catch(() => {
      if (active) {
        setPreview({
          entryId: entry.entryId,
          layoutId,
          project,
          screenIdsKey,
          images: null,
          failed: true,
        });
      }
    });
    return () => { active = false; };
  }, [entry.entryId, entry.previewLayoutId, entry.previewScreenIds.length, entry.previewProject, screenIdsKey]);

  const canRender = Boolean(
    entry.previewProject
      && entry.previewLayoutId
      && preview?.entryId === entry.entryId
      && preview.layoutId === entry.previewLayoutId
      && preview.project === entry.previewProject
      && preview.screenIdsKey === screenIdsKey
      && preview.images
      && !preview.failed,
  );
  const allScreensReady = readyScreens.identity === previewIdentity
    && entry.previewScreenIds.length > 0
    && entry.previewScreenIds.every((screenId) => readyScreens.screenIds.includes(screenId));
  return (
    <div data-preview-state={allScreensReady ? "ready" : "loading"} className="grid h-56 grid-cols-3 items-end gap-3 overflow-hidden rounded-t-2xl bg-[var(--editor-color-surface-subtle)] px-5 pb-0 pt-5">
      {entry.previewScreenIds.length > 0 ? entry.previewScreenIds.map((screenId) => (
        <div key={screenId} className="h-full min-w-0 overflow-hidden rounded-t-lg border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-muted)] shadow-sm">
          <div className={`size-full transition-opacity duration-300 ease-out motion-reduce:transition-none ${allScreensReady ? "opacity-100" : "opacity-0"}`}>
            {canRender ? <ScreenThumbnail project={entry.previewProject!} layoutId={entry.previewLayoutId!} screenId={screenId} images={preview!.images!} onReady={markScreenReady} /> : null}
          </div>
        </div>
      )) : <div className="col-span-3 self-center text-center text-sm font-medium text-[color:var(--editor-color-text-subtle)]">Preview unavailable</div>}
    </div>
  );
}
