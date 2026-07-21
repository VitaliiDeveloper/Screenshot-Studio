// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState } from "react";
import { useStore } from "zustand";
import { Download } from "lucide-react";
import { editorStore } from "../lib/editor-store";
import { withFlushedProject } from "../lib/debounced-save";
import { projectRequestHeaders } from "../lib/save-project";
import {
  createExportOperationId,
  parseExportProgress,
  type ExportProgressSnapshot,
} from "../lib/export-progress";
import { DialogShell, editorUi, MenuSelect } from "./editor-ui";
import {
  DEFAULT_EXPORT_FILTERS,
  launchExportArtifactDownload,
  normalizeExportFilters,
} from "./export-dialog-model";

/**
 * UI export dialog (spec Slice 3). Small on purpose: platform/device/locale filters (all default
 * to "all"), export progress, inline errors. It saves the current project first so /render and
 * the export route read exactly what the user sees, then downloads the zip the route returns.
 */
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

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore(editorStore, (s) => s.project);
  const activeLayoutId = useStore(editorStore, (s) => s.activeLayoutId);
  const [platform, setPlatform] = useState(DEFAULT_EXPORT_FILTERS.platform);
  const [device, setDevice] = useState(DEFAULT_EXPORT_FILTERS.device);
  const [locale, setLocale] = useState<string>(DEFAULT_EXPORT_FILTERS.locale);
  const [profile, setProfile] = useState<"store-bundle" | "web-share">("store-bundle");
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<ExportProgressSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadedFilename, setDownloadedFilename] = useState<string | null>(null);

  if (!open || !project || !activeLayoutId) return null;

  const layout = project.layouts.find((candidate) => candidate.id === activeLayoutId)!;
  const platforms = Array.from(new Set(layout.screens.map((screen) => screen.platform)));
  const devices = Array.from(new Set(layout.screens
    .filter((screen) => platform === "all" || screen.platform === platform)
    .map((screen) => screen.device)));
  const locales = Array.from(new Set(layout.screens
    .filter((screen) => platform === "all" || screen.platform === platform)
    .filter((screen) => device === "all" || screen.device === device)
    .map((screen) => screen.locale)));

  const runExport = async () => {
    const filters = normalizeExportFilters(layout, { platform, device, locale });
    setPending(true);
    setError(null);
    setDownloadedFilename(null);
    const operationId = createExportOperationId();
    let latestProgress: ExportProgressSnapshot = {
      operationId,
      phase: "preparing",
      completed: 0,
      total: 0,
    };
    setProgress(latestProgress);
    try {
      await withFlushedProject(async () => {
        let stopped = false;
        let pollInFlight = false;
        const refreshProgress = async () => {
          if (stopped || pollInFlight) return;
          pollInFlight = true;
          try {
            const response = await fetch(
              `/api/export/progress?operationId=${encodeURIComponent(operationId)}`,
              { cache: "no-store" },
            );
            if (!response.ok || stopped) return;
            const snapshot = parseExportProgress(await response.json().catch(() => undefined));
            if (snapshot?.operationId === operationId) {
              latestProgress = snapshot;
              setProgress(snapshot);
            }
          } catch {
            // Progress is auxiliary; the export request remains the source of success or failure.
          } finally {
            pollInFlight = false;
          }
        };
        const pollTimer = window.setInterval(() => { void refreshProgress(); }, 200);
        void refreshProgress();

        const exportRequest = fetch("/api/export", {
          method: "POST",
          headers: projectRequestHeaders({
            conditional: true,
            headers: { "content-type": "application/json" },
          }),
          body: JSON.stringify({
            layoutId: activeLayoutId,
            platform: filters.platform === "all" ? undefined : filters.platform,
            device: filters.device === "all" ? undefined : filters.device,
            locale: filters.locale === "all" ? undefined : filters.locale,
            profile,
            operationId,
          }),
        });
        let res: Response;
        try {
          res = await exportRequest;
        } finally {
          stopped = true;
          window.clearInterval(pollTimer);
        }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body.error ?? `Export failed (${res.status})`);
        }
        latestProgress = {
          operationId,
          phase: "ready",
          completed: latestProgress.total,
          total: latestProgress.total,
        };
        setProgress(latestProgress);
        const ticket = launchExportArtifactDownload(body, {
          origin: window.location.origin,
          createAnchor: () => document.createElement("a"),
          appendAnchor: (anchor) => document.body.appendChild(anchor as HTMLAnchorElement),
        });
        setDownloadedFilename(ticket.filename);
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <DialogShell
      title="Export bundle"
      description="Render store-ready PNGs and one zip through the shared export path."
      onClose={onClose}
      widthClass="max-w-md"
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center justify-between gap-4 text-xs">
          <span className="font-medium text-slate-600">Export profile</span>
          <MenuSelect
            ariaLabel="Export profile"
            value={profile}
            options={[
              { value: "store-bundle", label: "Store bundle" },
              { value: "web-share", label: "Web Share" },
            ]}
            onChange={setProfile}
            className="w-40"
          />
        </label>
        <label className="flex items-center justify-between gap-4 text-xs">
          <span className="font-medium text-slate-600">Platform</span>
          <MenuSelect
            ariaLabel="Platform"
            value={platform}
            options={[{ value: "all", label: "all" }, ...platforms.map((value) => ({ value, label: value }))]}
            onChange={(value) => {
              setPlatform(value);
              setDevice("all");
              setLocale("all");
            }}
            className="w-40"
          />
        </label>

        <label className="flex items-center justify-between gap-4 text-xs">
          <span className="font-medium text-slate-600">Device</span>
          <MenuSelect
            ariaLabel="Device"
            value={device}
            options={[{ value: "all", label: "all" }, ...devices.map((value) => ({ value, label: value }))]}
            onChange={(value) => {
              setDevice(value);
              setLocale("all");
            }}
            className="w-40"
          />
        </label>

        <label className="flex items-center justify-between gap-4 text-xs">
          <span className="font-medium text-slate-600">Locale</span>
          <MenuSelect
            ariaLabel="Locale"
            value={locale}
            options={[{ value: "all", label: "all" }, ...locales.map((entry) => ({ value: entry, label: entry }))]}
            onChange={setLocale}
            className="w-40"
          />
        </label>

        {error && <p className="whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">{error}</p>}
        {downloadedFilename && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200">
            Download started: {downloadedFilename}
          </p>
        )}
        {pending && progress && (
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200" role="status" aria-live="polite">
            <p className="text-xs font-medium text-slate-700">{progressLabel(progress)}</p>
            {progress.phase === "rendering" && progress.total > 0 ? (
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"
                role="progressbar"
                aria-label="Export rendering progress"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.completed}
              >
                <div
                  className="h-full rounded-full bg-blue-600 transition-[width]"
                  style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                />
              </div>
            ) : (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-500 motion-reduce:animate-none" />
              </div>
            )}
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button className={editorUi.buttonSecondary} onClick={onClose} disabled={pending}>
            Close
          </button>
          <button
            className={editorUi.buttonPrimary}
            onClick={runExport}
            disabled={pending}
          >
            <Download size={14} strokeWidth={2} />
            {pending ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
