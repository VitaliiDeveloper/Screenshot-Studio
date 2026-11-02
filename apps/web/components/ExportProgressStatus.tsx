// SPDX-License-Identifier: Apache-2.0
import React from "react";
import { LoaderCircle } from "lucide-react";
import {
  exportRenderProgressPercent,
  type ExportProgressSnapshot,
} from "@web/lib/export-progress.js";

function progressLabel(progress: ExportProgressSnapshot): string {
  switch (progress.phase) {
    case "preparing": return "Preparing export…";
    case "rendering": return `Rendering ${progress.completed} of ${progress.total}`;
    case "packaging": return "Packaging";
    case "finalizing": return "Preparing download…";
    case "uploading": return "Uploading to the store…";
    case "ready": return "Export ready";
    case "failed": return "Export failed";
  }
}

/** `currentPath` is the bundle path of the file being rendered, from the same entry list the server renders. */
export function ExportProgressStatus({
  progress,
  currentPath,
}: {
  progress: ExportProgressSnapshot;
  currentPath?: string;
}) {
  const renderProgressPercent = exportRenderProgressPercent(progress);
  const showPhaseActivity = progress.phase === "preparing"
    || progress.phase === "packaging"
    || progress.phase === "finalizing"
    || progress.phase === "uploading";

  return (
    <div className="rounded-lg bg-[var(--editor-color-surface-subtle)] px-3 py-2.5 ring-1 ring-[var(--editor-color-border)]" role="status" aria-live="polite">
      <p className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--editor-color-text-default)]">
        {showPhaseActivity && (
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 animate-spin text-[color:var(--editor-color-accent-text)] motion-reduce:animate-none"
          />
        )}
        {progressLabel(progress)}
      </p>
      {progress.phase === "rendering" && currentPath ? (
        <p className="mt-1 truncate font-mono text-[11px] text-[color:var(--editor-color-text-secondary)]" title={currentPath}>{currentPath}</p>
      ) : null}
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--editor-color-track)]"
        role="progressbar"
        aria-label="Export rendering progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(renderProgressPercent)}
        aria-valuetext={progress.total > 0
          ? `${progress.completed} of ${progress.total} screenshots rendered`
          : "Waiting for rendering to start"}
      >
        <div
          className="h-full rounded-full bg-[var(--editor-color-accent)] transition-[width]"
          style={{ width: `${renderProgressPercent}%` }}
        />
      </div>
    </div>
  );
}
