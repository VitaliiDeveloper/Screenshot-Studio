// SPDX-License-Identifier: Apache-2.0
import React from "react";
import { LoaderCircle } from "lucide-react";
import {
  exportRenderProgressPercent,
  type ExportProgressSnapshot,
} from "../lib/export-progress.js";

function progressLabel(progress: ExportProgressSnapshot): string {
  switch (progress.phase) {
    case "preparing": return "Preparing export…";
    case "rendering": return `Rendering ${progress.completed} of ${progress.total}…`;
    case "packaging": return "Packaging ZIP…";
    case "finalizing": return "Preparing download…";
    case "ready": return "Export ready";
    case "failed": return "Export failed";
  }
}

export function ExportProgressStatus({ progress }: { progress: ExportProgressSnapshot }) {
  const renderProgressPercent = exportRenderProgressPercent(progress);
  const showPhaseActivity = progress.phase === "preparing"
    || progress.phase === "packaging"
    || progress.phase === "finalizing";

  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200" role="status" aria-live="polite">
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
        {showPhaseActivity && (
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 animate-spin text-blue-600 motion-reduce:animate-none"
          />
        )}
        {progressLabel(progress)}
      </p>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"
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
          className="h-full rounded-full bg-blue-600 transition-[width]"
          style={{ width: `${renderProgressPercent}%` }}
        />
      </div>
    </div>
  );
}
