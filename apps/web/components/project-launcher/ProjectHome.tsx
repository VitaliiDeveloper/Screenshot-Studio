// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, LoaderCircle } from "lucide-react";
import { editorUi } from "../editor-ui/styles";
import {
  fetchActiveProject,
  type ActiveProjectSelection,
} from "../../lib/project-session";
import {
  downloadProjectArchive,
  requestProjectArchive,
} from "../../lib/project-archive-client";

export function ProjectHome() {
  const router = useRouter();
  const [project, setProject] = useState<ActiveProjectSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchActiveProject().then((selected) => {
      if (!active) return;
      if (!selected) {
        router.replace("/");
        return;
      }
      setProject(selected);
    }).catch((caught: unknown) => {
      if (active) setError((caught as Error).message);
    });
    return () => { active = false; };
  }, [router]);

  const exportProjectArchive = async () => {
    if (!project) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      downloadProjectArchive(await requestProjectArchive(project.projectId));
    } catch (caught) {
      setArchiveError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setArchiveBusy(false);
    }
  };

  if (error) {
    return <main className="grid min-h-dvh place-items-center p-6"><p role="alert" className={editorUi.statusError}>{error}</p></main>;
  }
  if (!project) {
    return <main className="grid min-h-dvh place-items-center p-6 text-sm text-[color:var(--editor-color-text-secondary)]">Loading project…</main>;
  }

  return (
    <main className="min-h-dvh bg-[var(--editor-color-surface-subtle)] px-6 py-12">
      <section className="mx-auto max-w-3xl rounded-2xl border border-[var(--editor-color-border)] bg-white p-8 shadow-sm">
        <p className={editorUi.sectionLabel}>Active project</p>
        <h1 className="mt-3 text-3xl font-semibold text-[color:var(--editor-color-text-strong)]">{project.name}</h1>
        <dl className="mt-6 grid gap-3 text-sm">
          <div><dt className="font-semibold">Source</dt><dd>{project.sourceKind}</dd></div>
          {project.capabilities.revealLocation && project.displayLocation ? (
            <div><dt className="font-semibold">Project file</dt><dd className="break-all">{project.displayLocation}</dd></div>
          ) : null}
        </dl>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/editor" className={editorUi.buttonPrimary}>Open workspace</Link>
          <Link href="/?switch=1" className={editorUi.buttonSecondary}>Project launcher</Link>
          {project.sourceKind === "managed-project" ? (
            <button type="button" className={editorUi.buttonSecondary} disabled={archiveBusy} onClick={() => { void exportProjectArchive(); }}>
              {archiveBusy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <Download aria-hidden="true" className="size-4" />}
              {archiveBusy ? "Preparing project archive…" : "Export project archive"}
            </button>
          ) : null}
        </div>
        {project.sourceKind === "managed-project" ? <p className="mt-4 text-xs leading-5 text-[color:var(--editor-color-text-muted)]">Project archive export creates a portable backup for later project import. It is separate from rendered store-image export.</p> : null}
        {archiveError ? <p role="alert" className={`mt-4 ${editorUi.statusError}`}>{archiveError}</p> : null}
      </section>
    </main>
  );
}
