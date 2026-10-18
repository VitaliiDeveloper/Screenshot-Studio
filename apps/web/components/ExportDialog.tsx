// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { Archive, Download, Images, Square } from "lucide-react";
import { editorStore } from "@web/lib/editor/editor-store";
import { DEFAULT_STORE_SPECS, type StoreSpecs } from "@screenshot-studio/core/export";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { withFlushedProject } from "@web/lib/editor/debounced-save";
import { countIssues } from "@web/lib/editor/editor-issues";
import { downloadProjectArchive, requestProjectArchive } from "@web/lib/clients/project-archive-client";
import { fetchActiveProject } from "@web/lib/clients/project-session";
import { getProjectPersistenceIdentity, projectRequestHeaders } from "@web/lib/clients/save-project";
import {
  createExportOperationId,
  parseExportProgress,
  type ExportProgressSnapshot,
} from "@web/lib/export-progress";
import type { ExportFileFailure } from "@web/lib/export-selection";
import { readJsonBody, responseErrorMessage } from "@web/lib/json-response";
import { cx, DialogShell, editorUi, MenuSelect } from "./editor-ui";
import {
  allExportChecks,
  checkedExportEntries,
  exportLocaleRows,
  exportScopeIssues,
  exportSizeRows,
  launchExportArtifactDownload,
  layoutExportEntries,
  parseExportFailures,
  parseExportOutcome,
  plural,
  type ExportChecks,
  type ExportOutcome,
} from "./export-dialog-model";
import { ExportDialogSelection } from "./ExportDialogSelection";
import { ExportProgressStatus } from "./ExportProgressStatus";

type ProjectArchiveAvailability =
  | { status: "checking" }
  | { status: "available" }
  | { status: "unavailable"; message: string };

const NO_ISSUES: readonly ProjectIssue[] = [];
const ZIP_FILENAMES = { "store-bundle": "app-store-screenshots-bundle.zip", "web-share": "web-share-package.zip" };

function toggled(values: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(values);
  if (!next.delete(value)) next.add(value);
  return next;
}

function FailedFiles({ failures, onGoTo }: {
  failures: readonly ExportFileFailure[];
  onGoTo?: (screenId: string) => void;
}) {
  return (
    <ul aria-label="Failed files" className="divide-y divide-[var(--editor-color-surface-muted)] rounded-[var(--editor-radius-control)] border border-[var(--editor-color-danger-border)] bg-[var(--editor-color-surface)]">
      {failures.map((failure) => (
        <li key={failure.relativePath} className="flex items-start gap-2.5 px-3 py-2">
          <span aria-hidden="true" className="mt-0.5 text-[11px] font-semibold text-[color:var(--editor-color-danger-text)]">✕</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[11px] text-[color:var(--editor-color-text-strong)]" title={failure.relativePath}>
              {failure.relativePath}
            </p>
            <p className="mt-0.5 text-xs text-[color:var(--editor-color-text-secondary)]">{failure.message}</p>
          </div>
          {onGoTo ? (
            <button
              type="button"
              aria-label={`Go to ${failure.relativePath}`}
              className={cx(editorUi.buttonSecondary, "!min-h-7 shrink-0 !text-xs")}
              onClick={() => onGoTo(failure.screenId)}
            >
              Go to
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function outcomeHeadline(outcome: ExportOutcome): string {
  const exported = `${outcome.written} of ${plural(outcome.total, "file")} exported`;
  return outcome.stopped ? `Stopped: ${exported}` : exported;
}

/**
 * Keeps rendered outputs and the portable editable project as distinct export actions. Both paths
 * flush pending saves first so the requested artifact matches the current Workspace state. Store
 * images read the same bundle entries and validation issues as the export route and Issues.
 */
export function ExportDialog({
  open,
  onClose,
  specs = DEFAULT_STORE_SPECS,
  issues = NO_ISSUES,
  onGoToScreen,
  onOpenIssues,
}: {
  open: boolean;
  onClose: () => void;
  specs?: StoreSpecs;
  issues?: readonly ProjectIssue[];
  onGoToScreen?: (screenId: string) => void;
  onOpenIssues?: () => void;
}) {
  const project = useStore(editorStore, (s) => s.project);
  const activeLayoutId = useStore(editorStore, (s) => s.activeLayoutId);
  // Unchecked values, so a size or locale added later starts checked like the toolbar count.
  const [unchecked, setUnchecked] = useState<ExportChecks>({ sizes: new Set(), locales: new Set() });
  const [profile, setProfile] = useState<"store-bundle" | "web-share">("store-bundle");
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const operationIdRef = useRef<string | null>(null);
  const [progress, setProgress] = useState<ExportProgressSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<ExportFileFailure[]>([]);
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);
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

  const built = layoutExportEntries(project, activeLayoutId, specs);
  const entries = "entries" in built ? built.entries : [];
  const all = allExportChecks(entries);
  const effectiveChecks: ExportChecks = {
    sizes: new Set([...all.sizes].filter((key) => !unchecked.sizes.has(key))),
    locales: new Set([...all.locales].filter((locale) => !unchecked.locales.has(locale))),
  };
  const checked = checkedExportEntries(entries, effectiveChecks);
  const scopedIssues = exportScopeIssues(entries, effectiveChecks, issues);
  const scopedCounts = countIssues(scopedIssues);
  const busy = pending || archivePending;
  const canExport = !busy && checked.length > 0 && scopedCounts.blockers === 0;

  const runExport = async () => {
    if (!canExport) return;
    const requested = checked.length;
    setPending(true);
    setStopping(false);
    setError(null);
    setFailures([]);
    setOutcome(null);
    setDownloadedFilename(null);
    const operationId = createExportOperationId();
    operationIdRef.current = operationId;
    let latestProgress: ExportProgressSnapshot = {
      operationId,
      phase: "preparing",
      completed: 0,
      total: requested,
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
            sizes: [...effectiveChecks.sizes],
            locales: [...effectiveChecks.locales],
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
        const body = await readJsonBody(res);
        if (!res.ok) {
          setFailures(parseExportFailures(body.failures));
          throw new Error(responseErrorMessage(body, `Export failed (${res.status})`));
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
        const finished = parseExportOutcome(body, requested);
        setOutcome(finished);
        setFailures(finished.failures);
        setDownloadedFilename(ticket.filename);
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      operationIdRef.current = null;
      setPending(false);
    }
  };
  const stopExport = () => {
    const operationId = operationIdRef.current;
    if (!operationId || stopping) return;
    setStopping(true);
    // A stop that arrives after rendering finished is a no-op; the export response still decides the result.
    void fetch(`/api/export/progress?operationId=${encodeURIComponent(operationId)}`, { method: "POST" })
      .catch(() => undefined);
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
  const closeDialog = () => {
    setArchiveAvailability({ status: "checking" });
    setArchiveError(null);
    setArchiveDownloadedFilename(null);
    onClose();
  };
  const goToScreen = onGoToScreen && ((screenId: string) => {
    closeDialog();
    onGoToScreen(screenId);
  });
  const openIssues = onOpenIssues && (() => {
    closeDialog();
    onOpenIssues();
  });
  const rendering = progress?.phase === "preparing" || progress?.phase === "rendering";

  return (
    <DialogShell
      title="Export"
      description="Choose rendered store images or a portable editable project archive."
      onClose={closeDialog}
      closeDisabled={busy}
      widthClass="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <section aria-labelledby="store-images-export-title" className={editorUi.insetPanel}>
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700"><Images aria-hidden="true" className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <h3 id="store-images-export-title" className="text-sm font-semibold text-slate-950">Store images</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">Render PNGs at exact store sizes and package them into one download.</p>
            </div>
            <MenuSelect
              ariaLabel="Export profile"
              value={profile}
              options={[
                { value: "store-bundle", label: "Store bundle" },
                { value: "web-share", label: "Web Share" },
              ]}
              onChange={setProfile}
              className="w-36"
            />
          </div>

          {"error" in built ? (
            <p role="alert" className={editorUi.statusError}>This layout cannot be exported: {built.error}</p>
          ) : (
            <ExportDialogSelection
              sizeRows={exportSizeRows(entries, effectiveChecks, scopedIssues, specs)}
              localeRows={exportLocaleRows(entries, effectiveChecks, issues)}
              checks={effectiveChecks}
              checked={checked}
              disabled={busy}
              showPaths={profile === "store-bundle"}
              zipFilename={ZIP_FILENAMES[profile]}
              onToggleSize={(key) => setUnchecked({ ...unchecked, sizes: toggled(unchecked.sizes, key) })}
              onToggleLocale={(locale) => setUnchecked({ ...unchecked, locales: toggled(unchecked.locales, locale) })}
            />
          )}

          {scopedCounts.blockers > 0 ? (
            <div className={cx(editorUi.statusError, "flex items-center gap-3")}>
              <p className="flex-1">
                {plural(scopedCounts.blockers, "blocker")} {scopedCounts.blockers === 1 ? "stops" : "stop"} this
                export. Fix {scopedCounts.blockers === 1 ? "it" : "them"} in Issues, or uncheck the sizes and locales
                {scopedCounts.blockers === 1 ? " it affects" : " they affect"}.
              </p>
              {openIssues ? <button type="button" className={cx(editorUi.buttonSecondary, "!min-h-7 shrink-0 !text-xs")} onClick={openIssues}>Review issues</button> : null}
            </div>
          ) : scopedCounts.warnings > 0 ? (
            <div className={cx(editorUi.statusWarning, "flex items-center gap-3")}>
              <p className="flex-1">{plural(scopedCounts.warnings, "warning")} in the checked files. Export still runs.</p>
              {openIssues ? <button type="button" className={cx(editorUi.buttonSecondary, "!min-h-7 shrink-0 !text-xs")} onClick={openIssues}>Review issues</button> : null}
            </div>
          ) : null}

          {error && <p role="alert" className={editorUi.statusError}>{error}</p>}
          {outcome ? (
            <p role="status" className={outcome.written < outcome.total ? editorUi.statusWarning : editorUi.statusProgress}>
              {outcomeHeadline(outcome)}
              {outcome.failures.length > 0 ? ` · ${outcome.failures.length} failed` : ""}
              {downloadedFilename ? `. Store image download started: ${downloadedFilename}` : ""}
            </p>
          ) : null}
          {failures.length > 0 ? <FailedFiles failures={failures} onGoTo={goToScreen} /> : null}
          {pending && progress ? (
            <ExportProgressStatus progress={progress} currentPath={checked[progress.completed]?.relativePath} />
          ) : null}
          <div className="flex items-center justify-end gap-2">
            {pending ? (
              <>
                <p className="mr-auto text-xs text-[color:var(--editor-color-text-secondary)]">Stop keeps the files already written.</p>
                <button
                  type="button"
                  className={editorUi.buttonSecondary}
                  onClick={stopExport}
                  disabled={stopping || !rendering}
                >
                  <Square aria-hidden="true" className="size-3.5" />
                  {stopping ? "Stopping…" : "Stop"}
                </button>
              </>
            ) : null}
            <button className={editorUi.buttonPrimary} onClick={runExport} disabled={!canExport}>
              <Download size={14} strokeWidth={2} />
              {pending ? "Exporting…" : `Export ${plural(checked.length, "file")}`}
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
