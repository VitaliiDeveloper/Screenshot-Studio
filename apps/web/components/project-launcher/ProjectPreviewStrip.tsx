// SPDX-License-Identifier: Apache-2.0
"use client";

import React from "react";
import { useEffect, useState } from "react";
import { loadProjectImages, type ImageCache } from "@screenshot-studio/core/assets";
import type { ProjectLibraryEntry } from "../../lib/project-library-client";
import { projectLibraryAssetUrl } from "../../lib/project-library-client";
import { ScreenThumbnail } from "../ScreenThumbnail";

export function ProjectPreviewStrip({ entry }: { entry: ProjectLibraryEntry }) {
  const [images, setImages] = useState<ImageCache | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setImages(null);
    setFailed(false);
    if (!entry.project || !entry.previewLayoutId || entry.previewScreenIds.length === 0) return;
    void loadProjectImages(
      entry.project,
      entry.previewLayoutId,
      (path) => projectLibraryAssetUrl(entry.entryId, path),
    ).then((loaded) => {
      if (active) setImages(loaded);
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => { active = false; };
  }, [entry.entryId, entry.previewLayoutId, entry.previewScreenIds, entry.project]);

  const canRender = entry.project && entry.previewLayoutId && images && !failed;
  return (
    <div className="grid h-56 grid-cols-3 items-end gap-3 overflow-hidden rounded-t-2xl bg-slate-50 px-5 pb-0 pt-5">
      {entry.previewScreenIds.length > 0 ? entry.previewScreenIds.map((screenId) => (
        <div key={screenId} className="h-full min-w-0 overflow-hidden rounded-t-lg border border-slate-200 bg-slate-100 shadow-sm">
          {canRender ? <ScreenThumbnail project={entry.project!} layoutId={entry.previewLayoutId!} screenId={screenId} images={images} /> : null}
        </div>
      )) : <div className="col-span-3 self-center text-center text-sm font-medium text-slate-400">Preview unavailable</div>}
    </div>
  );
}
