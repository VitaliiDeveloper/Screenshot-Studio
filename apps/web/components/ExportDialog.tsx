// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { Archive, Download, Images } from "lucide-react";
import { editorStore } from "@web/lib/editor-store";
import {
  type DesignLayout,
} from "@screenshot-studio/core/model";
import {
  DEFAULT_STORE_SPECS,
  destinationLabel,
  listOutputFamilies,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { withFlushedProject } from "@web/lib/debounced-save";
import { downloadProjectArchive, requestProjectArchive } from "@web/lib/project-archive-client";
import { fetchActiveProject } from "@web/lib/project-session";
import { getProjectPersistenceIdentity, projectRequestHeaders } from "@web/lib/save-project";
import {
  createExportOperationId,
  parseExportProgress,
  type ExportProgressSnapshot,
} from "@web/lib/export-progress";
import { DialogShell, editorUi, MenuSelect } from "./editor-ui";
import {
  DEFAULT_EXPORT_FILTERS,
  launchExportArtifactDownload,
  normalizeExportFilters,
} from "./export-dialog-model";
import { ExportProgressStatus } from "./ExportProgressStatus";
import { readJsonResponse } from "@web/lib/json-response";

type ProjectArchiveAvailability =
  | { status: "checking" }
  | { status: "available" }
  | { status: "unavailable"; message: string };

function exportDeviceLabel(
  layout: DesignLayout,
  platform: string,
  device: string,
  specs: StoreSpecs,
): string {
  const families = listOutputFamilies(specs);
  const labels = [...new Set(layout.screens
    .filter((screen) => platform === "all" || screen.platform === platform)
    .filter((screen) => screen.device === device)
    .map((screen) => families.find(
      ({ key }) => key === `${screen.platform}/${screen.device}`,
    )?.label)
    .filter((label) => label !== undefined))];
  if (labels.length === 0) throw new Error(`No output device family configured for ${platform}/${device}`);
  return labels.join(" / ");
}

/**
 * Keeps rendered outputs and the portable editable project as distinct export actions. Both paths
 * flush pending saves first so the requested artifact matches the current Workspace state.
 */
export function ExportDialog({
  open,
  onClose,
  specs = DEFAULT_STORE_SPECS,
}: {
  open: boolean;
  onClose: () => void;
  specs?: StoreSpecs;
}) {
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
  const [archiveAvailability, setArchiveAvailability] = useState<ProjectArchiveAvailability>({
    status: "checking",
  });
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveDownloadedFilename, setArchiveDownloadedFilename] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchActiveProject().then((selection) => {
      if (cancelled) return;
      setArchiveAvailability(selection?.capabilities.exportProjectArchive
        ? { status: "available" }
        : {
            status: "unavailable",
            message: "Project export is available for managed projects.",
          });
    }).catch(() => {
      if (!cancelled) {
        setArchiveAvailability({
          status: "unavailable",
          message: "Project export availability could not be checked. Close and reopen Export to retry.",
        });
      }
    });
    return () => { cancelled = true; };
  }, [open]);

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
    if (archivePending) return;
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
        const body = await readJsonResponse(res, `Export failed (${res.status})`);
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
  const runProjectArchiveExport = async () => {
    if (pending || archivePending || archiveAvailability.status !== "available") return;
    setArchivePending(true);
    setArchiveError(null);
    setArchiveDownloadedFilename(null);
    try {
      await withFlushedProject(async () => {
        const selection = await fetchActiveProject();
        const identity = getProjectPersistenceIdentity();
        if (!selection?.capabilities.exportProjectArchive) {
          throw new Error("Project export is available for managed projects.");
        }
        if (!identity || identity.projectId !== selection.projectId) {
          throw new Error("The active project changed before export could start.");
        }
        const ticket = await requestProjectArchive(identity.projectId, identity.revision);
        downloadProjectArchive(ticket);
        setArchiveDownloadedFilename(ticket.filename);
      });
    } catch (caught) {
      setArchiveError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setArchivePending(false);
    }
  };
  const busy = pending || archivePending;
  const closeDialog = () => {
    setArchiveAvailability({ status: "checking" });
    setArchiveError(null);
    setArchiveDownloadedFilename(null);
    onClose();
  };

  return (
    <DialogShell
      title="Export"
      description="Choose rendered store images or a portable editable project archive."
      onClose={closeDialog}
      widthClass="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <section aria-labelledby="store-images-export-title" className={editorUi.insetPanel}>
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700"><Images aria-hidden="true" className="size-4" /></span>
            <div>
              <h3 id="store-images-export-title" className="text-sm font-semibold text-slate-950">Store images</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">Render store-ready PNGs and package them into one download.</p>
            </div>
          </div>
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
              options={[{ value: "all", label: "all" }, ...platforms.map((value) => ({
                value,
                label: destinationLabel(value, specs),
              }))]}
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
              options={[{ value: "all", label: "all" }, ...devices.map((value) => ({
                value,
                label: exportDeviceLabel(layout, platform, value, specs),
              }))]}
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

          {error && <p role="alert" className={editorUi.statusError}>{error}</p>}
          {downloadedFilename && <p role="status" className={editorUi.statusProgress}>Store image download started: {downloadedFilename}</p>}
          {pending && progress && <ExportProgressStatus progress={progress} />}
          <div className="flex justify-end">
            <button className={editorUi.buttonPrimary} onClick={runExport} disabled={busy}>
              <Download size={14} strokeWidth={2} />
              {pending ? "Exporting images…" : "Export images"}
            </button>
          </div>
        </section>

        <section aria-labelledby="project-archive-export-title" className={editorUi.insetPanel}>
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-700"><Archive aria-hidden="true" className="size-4" /></span>
            <div>
              <h3 id="project-archive-export-title" className="text-sm font-semibold text-slate-950">Editable project</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">Download the project document with its project-owned screenshots, assets, fonts, themes, and templates for later import.</p>
            </div>
          </div>
          {archiveAvailability.status === "checking" ? <p role="status" className={editorUi.statusProgress}>Checking project export availability…</p> : null}
          {archiveAvailability.status === "unavailable" ? <p className={editorUi.statusWarning}>{archiveAvailability.message}</p> : null}
          {archiveError ? <p role="alert" className={editorUi.statusError}>{archiveError}</p> : null}
          {archiveDownloadedFilename ? <p role="status" className={editorUi.statusProgress}>Project download started: {archiveDownloadedFilename}</p> : null}
          <div className="flex justify-end">
            <button
              className={editorUi.buttonSecondary}
              onClick={runProjectArchiveExport}
              disabled={busy || archiveAvailability.status !== "available"}
            >
              <Archive aria-hidden="true" className="size-4" />
              {archivePending ? "Preparing project…" : "Export project"}
            </button>
          </div>
        </section>

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <button className={editorUi.buttonSecondary} onClick={closeDialog} disabled={busy}>Close</button>
        </div>
      </div>
    </DialogShell>
  );
}
