// SPDX-License-Identifier: Apache-2.0
"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  Ellipsis,
  LoaderCircle,
} from "lucide-react";
import { missingProjectImages } from "@web/lib/editor/editor-issues";
import { closeProjectSession } from "@web/lib/clients/project-close";
import { downloadProjectArchive, requestProjectArchive } from "@web/lib/clients/project-archive-client";
import { loadProjectHomeData, type ProjectHomeData } from "@web/lib/clients/project-home-client";
import { buildProjectHomeSummary } from "@web/lib/project-home-model";
import { LAYOUT_MODE_LABELS } from "@web/lib/layout-mode-labels";
import { editorStore } from "@web/lib/editor/editor-store";
import { getProjectPersistenceIdentity } from "@web/lib/clients/save-project";
import { projectInfoEntryBindingError } from "@web/lib/editor/editor-route";
import { editorUi } from "@web/components/editor-ui/styles";

const DynamicScreenThumbnail = dynamic(
  () => import("@web/components/ScreenThumbnail").then((module) => module.ScreenThumbnail),
  { ssr: false },
);

function screenCountLabel(count: number): string {
  return `${count} screen${count === 1 ? "" : "s"}`;
}

export function ProjectHome({ expectedProjectId, expectedEntryId }: {
  expectedProjectId?: string;
  expectedEntryId?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<ProjectHomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const saveError = useStore(editorStore, (state) => state.saveError);
  const entryBindingError = projectInfoEntryBindingError(expectedProjectId, expectedEntryId);

  useEffect(() => {
    let active = true;
    if (entryBindingError) return () => { active = false; };
    void loadProjectHomeData().then((loaded) => {
      if (!active) return;
      if (!loaded) {
        router.replace("/");
        return;
      }
      if (expectedProjectId && loaded.selection.projectId !== expectedProjectId) {
        setError("The active project changed before the requested Project Info could open.");
        return;
      }
      setData(loaded);
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    });
    return () => { active = false; };
  }, [entryBindingError, expectedProjectId, router]);

  const summary = useMemo(() => data ? buildProjectHomeSummary({
    project: data.resources.project,
    selection: data.selection,
    specs: data.resources.specs,
    missingAssets: missingProjectImages(data.resources.project, data.resources.images),
    fontWarnings: data.resources.fontWarnings.map(({ font, error: warning }) =>
      `${font.family} ${font.weight}: ${warning.message}`),
    saveError: getProjectPersistenceIdentity()?.projectId === data.selection.projectId
      ? saveError
      : null,
    entryId: expectedEntryId,
  }) : null, [data, expectedEntryId, saveError]);

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

  const exportProjectArchive = async () => {
    if (!data || archiveBusy || closeBusy) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      const ticket = await requestProjectArchive(data.selection.projectId, data.resources.revision);
      downloadProjectArchive(ticket);
    } catch (caught) {
      setArchiveError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setArchiveBusy(false);
    }
  };

  if (entryBindingError || error) {
    return <main className="grid min-h-dvh place-items-center p-6"><p role="alert" className={editorUi.statusError}>{entryBindingError ?? error}</p></main>;
  }
  if (!data || !summary) {
    return <main className="grid min-h-dvh place-items-center p-6 text-sm text-[color:var(--editor-color-text-secondary)]">Loading project info…</main>;
  }

  const continueAction = summary.actions.find((action) => action.id === "continue-editing");
  const archiveAction = summary.actions.find((action) => action.id === "project-archive-export");

  return (
    <main className="min-h-dvh bg-[var(--editor-color-surface-subtle)] px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-[1440px]">
        <Link href="/" className="inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-semibold text-[color:var(--editor-color-accent-text)] transition hover:text-[color:var(--editor-color-accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Projects
        </Link>

        <header className="mt-7 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h1 className="truncate text-3xl font-semibold tracking-[-0.025em] text-[color:var(--editor-color-text-strong)] sm:text-4xl">{summary.name}</h1>
              <span className="rounded-full border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-3 py-1 text-xs font-semibold text-[color:var(--editor-color-text-secondary)]">{summary.source.label}</span>
            </div>
            {summary.source.location ? <p className="mt-3 max-w-3xl break-all font-mono text-xs text-[color:var(--editor-color-text-muted)]"><span className="font-sans font-semibold">Project file: </span>{summary.source.location}</p> : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {continueAction?.enabled && continueAction.href ? (
              <Link href={continueAction.href} className={editorUi.buttonPrimary}>Open in Editor</Link>
            ) : (
              <span aria-disabled="true" className={`${editorUi.buttonPrimary} cursor-not-allowed opacity-50`}>Open in Editor</span>
            )}
            {archiveAction?.enabled ? (
              <button type="button" className={editorUi.buttonSecondary} disabled={archiveBusy || closeBusy} onClick={() => { void exportProjectArchive(); }}>
                {archiveBusy
                  ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
                  : <Download aria-hidden="true" className="size-4" />}
                <span className="text-[13px]">{archiveBusy ? "Preparing archive…" : "Export archive"}</span>
              </button>
            ) : null}
            <details className="group relative">
              <summary aria-label="Project info actions" className={`${editorUi.iconButton} list-none cursor-pointer bg-[var(--editor-color-surface)] [&::-webkit-details-marker]:hidden`}>
                <Ellipsis aria-hidden="true" className="size-4" />
              </summary>
              <div className="absolute right-0 top-12 z-20 w-64 rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-1.5 shadow-xl">
                <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-[var(--editor-color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-50" disabled={closeBusy || archiveBusy} onClick={() => { void closeCurrentProject(); }}>
                  <span className="flex items-center gap-2 text-sm font-semibold text-[color:var(--editor-color-text-strong)]">
                    {closeBusy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                    {closeBusy ? "Closing project…" : "Close project"}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[color:var(--editor-color-text-muted)]">End the active session and return to Projects.</span>
                </button>
              </div>
            </details>
          </div>
        </header>

        {closeError ? <p role="alert" className={`mt-5 ${editorUi.statusError}`}>Project was not closed. The active session and project data remain unchanged: {closeError}</p> : null}
        {archiveError ? <p role="alert" className={`mt-5 ${editorUi.statusError}`}>Project archive was not exported: {archiveError}</p> : null}

        <section aria-labelledby="project-screens" className="mt-8 rounded-3xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <h2 id="project-screens" className="text-xl font-semibold text-[color:var(--editor-color-text-strong)]">Screens</h2>
            <p className="text-xs leading-5 text-[color:var(--editor-color-text-muted)]">Rendered by the same shared renderer used for export.</p>
          </div>

          {summary.representativeScreens.length > 0 ? (
            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
              {summary.representativeScreens.map((screen) => (
                <figure key={`${screen.layoutId}/${screen.screenId}`} className="min-w-0">
                  <div className="h-[26rem] w-full overflow-hidden rounded-2xl border border-[var(--editor-color-border)] bg-[var(--editor-color-media-well)] p-3 shadow-sm">
                    <DynamicScreenThumbnail project={data.resources.project} layoutId={screen.layoutId} screenId={screen.screenId} images={data.resources.images} fit="contain" />
                  </div>
                  <figcaption className="mt-2.5">
                    <p className="truncate text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{screen.name}</p>
                    <p className="mt-0.5 truncate text-xs text-[color:var(--editor-color-text-muted)]">{screen.outputLabel} · {screen.layoutName}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] px-5 py-12 text-center text-sm text-[color:var(--editor-color-text-secondary)]">No screens yet. Open the project in Editor to create the first one.</div>
          )}

          <dl className="mt-7 grid border-t border-[var(--editor-color-border)] pt-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border-b border-[var(--editor-color-border)] px-3 py-3 sm:border-r lg:border-b-0"><dt className="text-xs text-[color:var(--editor-color-text-muted)]">Screens</dt><dd className="mt-1 text-base font-semibold text-[color:var(--editor-color-text-strong)]">{summary.screenCount}</dd></div>
            <div className="border-b border-[var(--editor-color-border)] px-3 py-3 lg:border-b-0 lg:border-r"><dt className="text-xs text-[color:var(--editor-color-text-muted)]">Layouts</dt><dd className="mt-1 text-base font-semibold text-[color:var(--editor-color-text-strong)]">{summary.layouts.length}</dd></div>
            <div className="border-b border-[var(--editor-color-border)] px-3 py-3 sm:border-b-0 sm:border-r"><dt className="text-xs text-[color:var(--editor-color-text-muted)]">Platforms</dt><dd className="mt-1 truncate text-base font-semibold text-[color:var(--editor-color-text-strong)]">{summary.platforms.join(", ") || "—"}</dd></div>
            <div className="px-3 py-3"><dt className="text-xs text-[color:var(--editor-color-text-muted)]">Locales</dt><dd className="mt-1 truncate text-base font-semibold text-[color:var(--editor-color-text-strong)]">{summary.locales.join(", ") || "—"}</dd></div>
          </dl>
        </section>

        {summary.readiness.length > 0 ? (
          <section aria-labelledby="project-issues" className="mt-6 rounded-3xl border border-[var(--editor-color-warning-border)] bg-[var(--editor-color-warning-surface)] p-5 sm:p-6">
            <h2 id="project-issues" className="flex items-center gap-2 text-sm font-semibold text-[color:var(--editor-color-warning-text-strong)]"><AlertTriangle aria-hidden="true" className="size-4" />Project issues</h2>
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {summary.readiness.map((item) => <li key={item.kind} className="rounded-2xl bg-[var(--editor-color-surface-translucent)] p-4 text-[color:var(--editor-color-warning-text-strong)] ring-1 ring-[var(--editor-color-warning-border)]"><p className="text-sm font-semibold">{item.label}</p><p className="mt-1 break-words text-xs leading-5">{item.detail}</p></li>)}
            </ul>
          </section>
        ) : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="project-layouts" className="rounded-3xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-5 shadow-sm sm:p-6">
            <h2 id="project-layouts" className="text-lg font-semibold text-[color:var(--editor-color-text-strong)]">Layouts</h2>
            <div className="mt-4 divide-y divide-[var(--editor-color-border)] overflow-hidden rounded-2xl border border-[var(--editor-color-border)]">
              {summary.layouts.map((layout) => (
                <div key={layout.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{layout.name}</p>
                    {layout.preferred ? <span className="rounded-full bg-[var(--editor-color-accent-subtle)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--editor-color-accent-text-strong)] ring-1 ring-[var(--editor-color-accent-border)]">Preferred</span> : null}
                    <span className="rounded-full bg-[var(--editor-color-surface-muted)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--editor-color-text-muted)]">{LAYOUT_MODE_LABELS[layout.mode]}</span>
                  </div>
                  <p className="shrink-0 text-xs text-[color:var(--editor-color-text-muted)]">{screenCountLabel(layout.screenCount)}{layout.emptyScreenCount > 0 ? ` · ${layout.emptyScreenCount} empty` : ""}</p>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="project-outputs" className="rounded-3xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-5 shadow-sm sm:p-6">
            <h2 id="project-outputs" className="text-lg font-semibold text-[color:var(--editor-color-text-strong)]">Store outputs</h2>
            <div className="mt-4 divide-y divide-[var(--editor-color-border)] overflow-hidden rounded-2xl border border-[var(--editor-color-border)]">
              {summary.outputFamilies.map((family) => (
                <div key={family.key} className="px-4 py-3.5">
                  <div className="flex items-center justify-between gap-4"><p className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{family.label}</p><p className="shrink-0 text-xs text-[color:var(--editor-color-text-muted)]">{screenCountLabel(family.screenCount)}</p></div>
                  <p className="mt-1 truncate text-xs text-[color:var(--editor-color-text-secondary)]">{family.storeTargets.join(", ")}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
