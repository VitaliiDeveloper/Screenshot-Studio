// SPDX-License-Identifier: Apache-2.0
"use client";

import type { ImageCache } from "@screenshot-studio/core/assets";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import type { Screen } from "@screenshot-studio/core/model";
import type { WorkspaceView } from "@web/lib/editor/editor-workspace";
import { editorStore } from "@web/lib/editor/editor-store";
import { cx } from "@web/components/editor-ui";
import { EditorStage } from "@web/components/EditorStage";
import { ScreenPreviewMetadata, ScreenPreviewTitle } from "./ScreenPreviewLabels";

/** One artboard with its labels; in Overview an inactive artboard is a button that activates it. */
export function IsolatedScreenPreview({
  screen,
  active,
  connected,
  view,
  images,
  zoom,
  issues,
}: {
  screen: Screen;
  active: boolean;
  connected: boolean;
  view: WorkspaceView;
  images: ImageCache;
  zoom: number;
  issues?: readonly ProjectIssue[];
}) {
  const selectable = !active && view === "overview";
  const previewWidth = screen.artboard.width * zoom;
  return (
    <div
      data-testid="artboard-preview-item"
      data-artboard-screen-id={screen.id}
      className="min-w-0 shrink-0"
      style={{ width: previewWidth }}
    >
      <ScreenPreviewTitle screen={screen} active={active} />
      <div
        role={selectable ? "button" : undefined}
        tabIndex={selectable ? 0 : undefined}
        aria-label={selectable ? `Edit ${screen.name}` : undefined}
        data-screen-id={screen.id}
        className={cx(
          "relative bg-white shadow-[0_8px_28px_rgba(15,23,42,0.12)]",
          active ? "ring-2 ring-blue-600 ring-offset-2 ring-offset-slate-50" : "ring-1 ring-slate-300",
          selectable && "cursor-pointer transition-shadow hover:shadow-[0_12px_34px_rgba(15,23,42,0.16)]",
        )}
        onClick={() => {
          if (selectable) editorStore.getState().selectScreen(screen.id);
        }}
        onKeyDown={(event) => {
          if (selectable && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            editorStore.getState().selectScreen(screen.id);
          }
        }}
      >
        <EditorStage
          images={images}
          zoom={zoom}
          issues={issues}
          screenId={screen.id}
          interactive={connected ? false : active}
        />
      </div>
      <ScreenPreviewMetadata screen={screen} />
    </div>
  );
}
