// SPDX-License-Identifier: Apache-2.0
"use client";

import { memo, useEffect, useRef } from "react";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { renderScreen } from "@screenshot-studio/core/engine";
import type { Project } from "@screenshot-studio/core/model";
import { screenThumbnailInputsEqual } from "../lib/screen-thumbnail";

/** A small raster preview produced by the same renderer as editor and export. */
function ScreenThumbnailImpl({
  project,
  screenId,
  images,
}: {
  project: Project;
  screenId: string;
  images: ImageCache;
}) {
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const container = document.createElement("div");
    const stage = renderScreen(container, project, screenId, images);
    const nextSrc = stage.toDataURL({ pixelRatio: 0.12, mimeType: "image/png" });
    stage.destroy();
    if (imageRef.current) imageRef.current.src = nextSrc;
  }, [images, project, screenId]);

  // A generated data URL cannot use Next Image's loader or remote optimization pipeline.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={imageRef} alt="" className="size-full object-cover" />;
}

/** Unrelated screen edits should not synchronously rerasterize every thumbnail in the project. */
export const ScreenThumbnail = memo(ScreenThumbnailImpl, screenThumbnailInputsEqual);
