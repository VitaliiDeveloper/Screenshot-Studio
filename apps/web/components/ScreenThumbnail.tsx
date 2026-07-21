// SPDX-License-Identifier: Apache-2.0
"use client";

import { memo, useEffect, useRef } from "react";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { renderScreen } from "@screenshot-studio/core/engine";
import type { Project } from "@screenshot-studio/core/model";
import { screenThumbnailInputsEqual, screenThumbnailPixelRatio } from "@web/lib/screen-thumbnail";

/** A small raster preview produced by the same renderer as editor and export. */
function ScreenThumbnailImpl({
  project,
  layoutId,
  screenId,
  images,
  fit = "cover",
}: {
  project: Project;
  layoutId: string;
  screenId: string;
  images: ImageCache;
  fit?: "cover" | "contain";
}) {
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    let frame: number | null = null;

    const render = () => {
      const bounds = image.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const container = document.createElement("div");
      const stage = renderScreen(container, project, layoutId, screenId, images);
      try {
        image.src = stage.toDataURL({
          pixelRatio: screenThumbnailPixelRatio({
            stageWidth: stage.width(),
            stageHeight: stage.height(),
            viewportWidth: bounds.width,
            viewportHeight: bounds.height,
            devicePixelRatio: window.devicePixelRatio,
            fit,
          }),
          mimeType: "image/png",
        });
      } finally {
        stage.destroy();
      }
    };
    const scheduleRender = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        render();
      });
    };
    const observer = new ResizeObserver(scheduleRender);
    observer.observe(image);
    scheduleRender();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [fit, images, layoutId, project, screenId]);

  // A generated data URL cannot use Next Image's loader or remote optimization pipeline.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={imageRef} alt="" className={`size-full ${fit === "contain" ? "object-contain" : "object-cover"}`} />;
}

/** Unrelated screen edits should not synchronously rerasterize every thumbnail in the project. */
export const ScreenThumbnail = memo(ScreenThumbnailImpl, screenThumbnailInputsEqual);
