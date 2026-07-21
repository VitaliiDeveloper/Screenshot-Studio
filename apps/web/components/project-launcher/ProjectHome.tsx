// SPDX-License-Identifier: Apache-2.0
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  LoaderCircle,
} from "lucide-react";
import { editorStore } from "../../lib/editor-store";
import { getProjectPersistenceIdentity } from "../../lib/save-project";
import {
  applyEditorResourceResult,
  missingImageUrls,
} from "../../app/editor/editor-resources";
import { loadProjectHomeData, type ProjectHomeData } from "../../lib/project-home-client";
import { closeProjectSession } from "../../lib/project-close";
import {
  discardActiveProjectPersistence,
  hasPendingProjectSave,
  switchActiveProject,
} from "../../lib/debounced-save";
import { clearWorkspaceNavigationState } from "../../lib/editor-workspace-navigation";
import {
  buildProjectHomeSummary,
  type ProjectHomeAction,
} from "../../lib/project-home-model";
import {
  downloadProjectArchive,
  requestProjectArchive,
} from "../../lib/project-archive-client";
import { editorUi } from "../editor-ui/styles";
import { CaptureImportDialog } from "./CaptureImportDialog";
import { ProjectDeletionDialog } from "./ProjectDeletionDialog";
import { useManagedProjectDeletion } from "./useManagedProjectDeletion";
import {
  assertCaptureImportHandoff,
  assertCaptureImportRecoveryTarget,
  useCaptureImportController,
} from "./useCaptureImportController";

const DynamicScreenThumbnail = dynamic(
  () => import("../ScreenThumbnail").then((module) => module.ScreenThumbnail),
  { ssr: false },
);

function ActionControl({
  action,
  onCaptureImport,
}: {
  action: ProjectHomeAction;
  onCaptureImport(): void;
}) {
  const className = "group flex min-h-28 flex-col justify-between rounded-2xl border border-[var(--editor-color-border)] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--editor-color-border-strong)] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] motion-reduce:transform-none";
  if (action.id === "capture-import" && action.enabled) {
    return (
      <button type="button" className={className} onClick={onCaptureImport}>
        <div><p className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{action.label}</p><p className="mt-1 text-xs leading-5 text-[color:var(--editor-color-text-secondary)]">{action.description}</p></div>
        <ArrowRight aria-hidden="true" className="mt-3 size-4 text-violet-600 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
      </button>
    );
  }
  if (!action.enabled || !action.href) {
    return (
      <div aria-disabled="true" className={`${className} cursor-not-allowed opacity-60`}>
        <div><p className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{action.label}</p><p className="mt-1 text-xs leading-5 text-[color:var(--editor-color-text-secondary)]">{action.description}</p></div>
        <span className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--editor-color-text-muted)]">Not available in this launcher slice</span>
      </div>
    );
  }
  return (
    <Link href={action.href} className={className}>
      <div><p className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{action.label}</p><p className="mt-1 text-xs leading-5 text-[color:var(--editor-color-text-secondary)]">{action.description}</p></div>
      <ArrowRight aria-hidden="true" className="mt-3 size-4 text-blue-600 transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none" />
    </Link>
  );
}

export function ProjectHome({ expectedProjectId }: { expectedProjectId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<ProjectHomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [deletionGateError, setDeletionGateError] = useState<string | null>(null);
  const deletion = useManagedProjectDeletion({
    onDeleted: (projectId) => {
      discardActiveProjectPersistence();
      clearWorkspaceNavigationState(projectId);
      router.replace("/");
      router.refresh();
    },
  });
  const saveError = useStore(editorStore, (state) => state.saveError);
  const currentCaptureTarget = useMemo(() => {
    if (!data || !data.selection.capabilities.writeInPlace
      || !data.selection.capabilities.projectLocalResources) return null;
    return {
      projectId: data.selection.projectId,
      revision: data.resources.revision,
      projectName: data.resources.project.meta.name,
      preferredLayoutId: data.resources.project.preferredExportLayoutId,
      layouts: data.resources.project.layouts.map(({ id, name }) => ({ id, name })),
    };
  }, [data]);
  const completeCaptureImport = useCallback(async (
    result: Parameters<typeof assertCaptureImportHandoff>[0],
    destinationKind: "current-project" | "new-project",
    signal: AbortSignal,
  ) => {
    const loaded = await loadProjectHomeData();
    if (signal.aborted) throw new DOMException("Capture import handoff cancelled", "AbortError");
    assertCaptureImportHandoff(result, loaded?.selection.projectId);
    if (!loaded) return;
    setError(null);
    setData(loaded);
    applyEditorResourceResult(loaded.resources);
    if (destinationKind === "new-project") {
      router.replace(`/home?project=${encodeURIComponent(result.projectId)}`);
    }
    router.refresh();
  }, [router]);
  const recoverCaptureTarget = useCallback(async () => {
    const loaded = await loadProjectHomeData();
    assertCaptureImportRecoveryTarget(loaded);
    discardActiveProjectPersistence();
    applyEditorResourceResult(loaded.resources);
    setError(null);
    setData(loaded);
    router.replace("/home");
    router.refresh();
  }, [router]);
  const captureImport = useCaptureImportController({
    currentTarget: currentCaptureTarget,
    activateNewProject: switchActiveProject,
    onCompleted: completeCaptureImport,
    onRecoverStale: recoverCaptureTarget,
  });
  const openCaptureImport = captureImport.open;
  useEffect(() => {
    let active = true;
    void loadProjectHomeData().then((loaded) => {
      if (!active) return;
      if (!loaded) {
        router.replace("/");
        return;
      }
      if (expectedProjectId && loaded.selection.projectId !== expectedProjectId) {
        setError("The active project changed before the requested Project Home could open.");
        return;
      }
      setData(loaded);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => { active = false; };
  }, [expectedProjectId, router]);

  const summary = useMemo(() => data ? buildProjectHomeSummary({
    project: data.resources.project,
    selection: data.selection,
    specs: data.resources.specs,
    missingAssets: missingImageUrls(data.resources.project, data.resources.images),
    fontWarnings: data.resources.fontWarnings.map(({ font, error: warning }) =>
      `${font.family} ${font.weight}: ${warning.message}`),
    saveError: getProjectPersistenceIdentity()?.projectId === data.selection.projectId
      ? saveError
      : null,
  }) : null, [data, saveError]);

  const scopedSaveError = data
    && getProjectPersistenceIdentity()?.projectId === data.selection.projectId
    ? saveError
    : null;

  const exportProjectArchive = async () => {
    if (!data || closeBusy) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      downloadProjectArchive(await requestProjectArchive(
        data.selection.projectId,
        data.resources.revision,
      ));
    } catch (caught) {
      setArchiveError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setArchiveBusy(false);
    }
  };

  const closeCurrentProject = async () => {
    if (!data || closeBusy || archiveBusy) return;
    setCloseBusy(true);
    setCloseError(null);
    try {
      await closeProjectSession(data.selection.projectId, {
        navigate: () => router.push("/?switch=1"),
      });
    } catch (caught) {
      setCloseError(caught instanceof Error ? caught.message : String(caught));
      setCloseBusy(false);
    }
  };

  const openPermanentDeletion = () => {
    if (!data || closeBusy || archiveBusy
      || !data.selection.capabilities.deleteProjectPermanently) return;
    if (!Number.isSafeInteger(data.selection.lifecycleRevision)
      || (data.selection.lifecycleRevision ?? 0) <= 0) {
      setDeletionGateError("Permanent deletion is unavailable until Project Home is reloaded.");
      return;
    }
    if (scopedSaveError || hasPendingProjectSave()) {
      setDeletionGateError("Permanent deletion is blocked until pending Workspace changes are saved successfully.");
      return;
    }
    setDeletionGateError(null);
    deletion.open(data);
  };

  if (error) {
    return <main className="grid min-h-dvh place-items-center p-6"><p role="alert" className={editorUi.statusError}>{error}</p></main>;
  }
  if (!data || !summary) {
    return <main className="grid min-h-dvh place-items-center p-6 text-sm text-[color:var(--editor-color-text-secondary)]">Loading project overview…</main>;
  }

  const archiveAction = summary.actions.find((action) => action.id === "project-archive-export");
  const deleteAction = summary.actions.find((action) => action.id === "permanently-delete-project");
  const continueAction = summary.actions.find((action) => action.id === "continue-editing");
  const importAction = summary.actions.find((action) => action.id === "import-project");
  const primaryActions = summary.actions.filter((action) =>
    action.id !== "project-archive-export" && action.id !== "permanently-delete-project");

  return (
    <main className="min-h-dvh bg-[var(--editor-color-surface-subtle)] px-4 py-8 sm:px-6 lg:py-12">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-[var(--editor-color-border)] bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className={editorUi.sectionLabel}>Project Home</p>
              <h1 className="mt-3 truncate text-3xl font-semibold text-[color:var(--editor-color-text-strong)] sm:text-4xl">{summary.name}</h1>
              <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="text-[color:var(--editor-color-text-muted)]">Source</dt><dd className="mt-1 font-semibold text-[color:var(--editor-color-text-strong)]">{summary.source.label}</dd></div>
                <div><dt className="text-[color:var(--editor-color-text-muted)]">Preferred export layout</dt><dd className="mt-1 font-semibold text-[color:var(--editor-color-text-strong)]">{summary.preferredLayout.name}</dd></div>
                <div><dt className="text-[color:var(--editor-color-text-muted)]">Screens</dt><dd className="mt-1 font-semibold text-[color:var(--editor-color-text-strong)]">{summary.screenCount}</dd></div>
                <div><dt className="text-[color:var(--editor-color-text-muted)]">Layouts</dt><dd className="mt-1 font-semibold text-[color:var(--editor-color-text-strong)]">{summary.layouts.length}</dd></div>
              </dl>
              {summary.source.location ? <p className="mt-4 break-all rounded-xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"><span className="font-sans font-semibold">Project file: </span>{summary.source.location}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              {continueAction?.enabled && continueAction.href ? <Link href={continueAction.href} className={editorUi.buttonPrimary}>Continue in Workspace</Link> : null}
              {importAction?.enabled && importAction.href ? <Link href={importAction.href} className={editorUi.buttonSecondary}>Import another project</Link> : null}
              <button type="button" className={editorUi.buttonSecondary} disabled={closeBusy || archiveBusy} onClick={() => { void closeCurrentProject(); }}>
                {closeBusy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                {closeBusy ? "Closing project…" : "Close project"}
              </button>
            </div>
          </div>
          {closeError ? <p role="alert" className={`mt-5 ${editorUi.statusError}`}>Project was not closed. The active session and project data remain unchanged: {closeError}</p> : null}
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,0.8fr)]">
          <div className="space-y-6">
            <section aria-labelledby="project-structure" className="rounded-3xl border border-[var(--editor-color-border)] bg-white p-6 shadow-sm">
              <h2 id="project-structure" className="text-lg font-semibold text-[color:var(--editor-color-text-strong)]">Project structure</h2>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {summary.layouts.map((layout) => (
                  <article key={layout.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex items-start justify-between gap-3"><h3 className="font-semibold text-slate-950">{layout.name}</h3><span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600 ring-1 ring-slate-200">{layout.mode}</span></div>
                    <p className="mt-2 text-xs text-slate-600">{layout.screenCount} screen{layout.screenCount === 1 ? "" : "s"} · {layout.emptyScreenCount} empty{layout.preferred ? " · Preferred for export" : ""}</p>
                  </article>
                ))}
              </div>
              <dl className="mt-5 grid gap-4 border-t border-slate-200 pt-5 sm:grid-cols-2">
                <div><dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Supported platforms</dt><dd className="mt-2 text-sm text-slate-800">{summary.platforms.join(", ")}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Locales</dt><dd className="mt-2 text-sm text-slate-800">{summary.locales.join(", ")}</dd></div>
              </dl>
            </section>

            <section aria-labelledby="project-outputs" className="rounded-3xl border border-[var(--editor-color-border)] bg-white p-6 shadow-sm">
              <h2 id="project-outputs" className="text-lg font-semibold text-[color:var(--editor-color-text-strong)]">Output families and store targets</h2>
              <div className="mt-5 divide-y divide-slate-200">
                {summary.outputFamilies.map((family) => <div key={family.key} className="grid gap-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,13rem)_1fr]"><div><p className="text-sm font-semibold text-slate-950">{family.label}</p><p className="text-xs text-slate-500">{family.screenCount} screen{family.screenCount === 1 ? "" : "s"}</p></div><p className="text-sm text-slate-700">{family.storeTargets.join(", ")}</p></div>)}
              </div>
            </section>

            <section aria-labelledby="project-actions" className="rounded-3xl border border-[var(--editor-color-border)] bg-white p-6 shadow-sm">
              <h2 id="project-actions" className="text-lg font-semibold text-[color:var(--editor-color-text-strong)]">Next actions</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{primaryActions.map((action) => <ActionControl key={action.id} action={action} onCaptureImport={openCaptureImport} />)}</div>
              {archiveAction?.enabled ? (
                <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold text-slate-950">Export project archive</h3><p className="mt-1 text-xs leading-5 text-slate-600">Project archive export creates a portable backup for later project import. It is separate from rendered store-image export.</p></div><button type="button" className={editorUi.buttonSecondary} disabled={archiveBusy || closeBusy} onClick={() => { void exportProjectArchive(); }}>{archiveBusy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <Download aria-hidden="true" className="size-4" />}{archiveBusy ? "Preparing project archive…" : "Export project archive"}</button></div>
                  {archiveError ? <p role="alert" className={`mt-3 ${editorUi.statusError}`}>{archiveError}</p> : null}
                </div>
              ) : null}
              {deleteAction?.enabled ? (
                <div className="mt-5 rounded-2xl border border-[var(--editor-color-danger-border)] bg-[var(--editor-color-danger-surface)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div><h3 className="text-sm font-semibold text-[color:var(--editor-color-danger-text)]">Permanently delete project</h3><p className="mt-1 text-xs leading-5 text-[color:var(--editor-color-danger-text)]">Irreversibly removes this managed project and its project-local resources. Close project only ends the active session.</p></div>
                    <button type="button" className={editorUi.buttonDanger} disabled={closeBusy || archiveBusy} onClick={openPermanentDeletion}>Permanently delete project</button>
                  </div>
                  {deletionGateError ? <p role="alert" className={`mt-3 ${editorUi.statusError}`}>{deletionGateError}</p> : null}
                </div>
              ) : null}
            </section>
          </div>

          <aside className="space-y-6">
            <section aria-labelledby="project-previews" className="rounded-3xl border border-[var(--editor-color-border)] bg-white p-6 shadow-sm">
              <h2 id="project-previews" className="text-lg font-semibold text-[color:var(--editor-color-text-strong)]">Representative previews</h2>
              <p className="mt-1 text-xs leading-5 text-slate-600">Each preview is rasterized by the existing shared renderer.</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {summary.representativeScreens.map((screen) => (
                  <figure key={screen.layoutId} className="min-w-0"><div className="aspect-[9/16] overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-sm"><DynamicScreenThumbnail project={data.resources.project} layoutId={screen.layoutId} screenId={screen.screenId} images={data.resources.images} /></div><figcaption className="mt-2"><p className="truncate text-xs font-semibold text-slate-900">{screen.name}</p><p className="truncate text-[10px] text-slate-500">{screen.layoutName}</p></figcaption></figure>
                ))}
              </div>
            </section>

            <section aria-labelledby="project-readiness" className="rounded-3xl border border-[var(--editor-color-border)] bg-white p-6 shadow-sm">
              <h2 id="project-readiness" className="text-lg font-semibold text-[color:var(--editor-color-text-strong)]">Readiness</h2>
              {summary.readiness.length === 0 ? <div className="mt-4 flex gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-900"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" /><p className="text-sm">No known blockers from the current project services.</p></div> : <ul className="mt-4 space-y-3">{summary.readiness.map((item) => <li key={item.kind} className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-amber-950"><AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" /><div><p className="text-sm font-semibold">{item.label}</p><p className="mt-1 break-words text-xs leading-5">{item.detail}</p></div></li>)}</ul>}
            </section>

            <section aria-labelledby="project-guidance" className="rounded-3xl border border-[var(--editor-color-border)] bg-white p-6 shadow-sm">
              <h2 id="project-guidance" className="text-lg font-semibold text-[color:var(--editor-color-text-strong)]">Workflow guide</h2>
              <dl className="mt-4 space-y-4 text-xs leading-5 text-slate-600">
                <div><dt className="font-semibold text-slate-900">Project templates</dt><dd>Complete creation-only starters are available from Create project on App Home.</dd></div>
                <div><dt className="font-semibold text-slate-900">Screen templates</dt><dd>Project-local reusable screens are applied from the Workspace Screen templates library.</dd></div>
                <div><dt className="font-semibold text-slate-900">Component presets</dt><dd>Reusable element groups are distinct from both complete project templates and full-screen templates.</dd></div>
                <div><dt className="font-semibold text-slate-900">Layout modes</dt><dd>Isolated and connected describe how a layout composes screens; Project Home reports them without editing content.</dd></div>
                <div><dt className="font-semibold text-slate-900">Project import</dt><dd>Folder, ZIP, or JSON input is validated into a separate managed copy.</dd></div>
                <div><dt className="font-semibold text-slate-900">Capture import</dt><dd>Previews raw PNG capture folders before adding them to this project or a new managed project.</dd></div>
                <div><dt className="font-semibold text-slate-900">Project archive export</dt><dd>Downloads portable project files and resources for later import.</dd></div>
                <div><dt className="font-semibold text-slate-900">Store-image export</dt><dd>Renders exact PNG output bundles from a selected layout through the shared renderer.</dd></div>
                <div><dt className="font-semibold text-slate-900">Project lifecycle</dt><dd>Close project ends the active session. Remove from recents changes App Home history only. This launcher has no Trash or Restore surface; Permanently delete project is a separate managed-only action.</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      </div>
      {captureImport.state.status === "closed" ? null : (
        <CaptureImportDialog
          state={captureImport.state}
          onClose={captureImport.close}
          onSelectFiles={captureImport.selectFiles}
          onChooseDestination={captureImport.chooseDestination}
          onChooseCurrentLayout={captureImport.chooseCurrentLayout}
          onChangeNewProject={captureImport.changeNewProject}
          onPreview={captureImport.preview}
          onApply={captureImport.apply}
          onCancel={captureImport.cancel}
          onRetry={captureImport.retry}
          onRecoverStale={captureImport.recoverStale}
        />
      )}
      {deletion.dialog && deletion.projectName ? (
        <ProjectDeletionDialog
          projectName={deletion.projectName}
          state={deletion.dialog}
          confirmation={deletion.confirmation}
          acknowledged={deletion.acknowledged}
          onConfirmationChange={deletion.setConfirmation}
          onAcknowledgedChange={deletion.setAcknowledged}
          onExportArchive={() => { void deletion.exportArchive(); }}
          onContinueWithoutArchive={deletion.continueWithoutArchive}
          onConfirmDelete={() => { void deletion.confirm(); }}
          onRetryDeletion={() => { void deletion.retry(); }}
          onClose={deletion.close}
        />
      ) : null}
    </main>
  );
}
