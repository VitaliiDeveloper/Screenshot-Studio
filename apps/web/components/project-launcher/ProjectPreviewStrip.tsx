// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useEffect, useState } from "react";
import { loadProjectImages, type ImageCache } from "@screenshot-studio/core/assets";
import type { Project } from "@screenshot-studio/core/model";
import type { ProjectLibraryEntry } from "@web/lib/project-library-client";
import { projectLibraryAssetUrl } from "@web/lib/project-library-client";
import { ScreenThumbnail } from "@web/components/ScreenThumbnail";

export function ProjectPreviewStrip({ entry }: { entry: ProjectLibraryEntry }) {
  const screenIdsKey = entry.previewScreenIds.join("\u0000");
  const [preview, setPreview] = useState<{
    entryId: string;
    layoutId: string;
    project: Project;
    screenIdsKey: string;
    images: ImageCache | null;
    failed: boolean;
  } | null>(null);

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
  return (
    <div className="grid h-56 grid-cols-3 items-end gap-3 overflow-hidden rounded-t-2xl bg-slate-50 px-5 pb-0 pt-5">
      {entry.previewScreenIds.length > 0 ? entry.previewScreenIds.map((screenId) => (
        <div key={screenId} className="h-full min-w-0 overflow-hidden rounded-t-lg border border-slate-200 bg-slate-100 shadow-sm">
          {canRender ? <ScreenThumbnail project={entry.previewProject!} layoutId={entry.previewLayoutId!} screenId={screenId} images={preview!.images!} /> : null}
        </div>
      )) : <div className="col-span-3 self-center text-center text-sm font-medium text-slate-400">Preview unavailable</div>}
    </div>
  );
}
