// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { editorUi } from "../editor-ui/styles";
import {
  fetchActiveProject,
  type ActiveProjectDescriptor,
} from "../../lib/project-session";

export function ProjectHome() {
  const router = useRouter();
  const [project, setProject] = useState<ActiveProjectDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          <Link href="/?switch=1" className={editorUi.buttonSecondary}>Open another project</Link>
        </div>
      </section>
    </main>
  );
}
