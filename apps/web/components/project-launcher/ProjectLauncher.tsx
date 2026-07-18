// SPDX-License-Identifier: Apache-2.0
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { editorUi } from "../editor-ui/styles";
import { fetchActiveProject } from "../../lib/project-session";

export function ProjectLauncher({ allowSwitch }: { allowSwitch: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (allowSwitch) return;
    let active = true;
    void fetchActiveProject().then((project) => {
      if (active && project) router.replace("/home");
    }).catch((caught: unknown) => {
      if (active) setError((caught as Error).message);
    });
    return () => { active = false; };
  }, [allowSwitch, router]);

  return (
    <main className="min-h-dvh bg-[var(--editor-color-surface-subtle)] px-6 py-12">
      <section className="mx-auto max-w-3xl">
        <p className={editorUi.sectionLabel}>Screenshot Studio</p>
        <h1 className="mt-3 flex items-center gap-3 text-4xl font-semibold text-[color:var(--editor-color-text-strong)]">
          <FolderOpen aria-hidden="true" className="size-9 text-[color:var(--editor-color-accent)]" />
          No active project
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[color:var(--editor-color-text-secondary)]">
          Browser project import is delivered by the next launcher workflow. This foundation build opens local projects through explicit CLI or server startup.
        </p>
        {error ? <p role="alert" className={`mt-6 ${editorUi.statusError}`}>{error}</p> : null}
        <section
          className="mt-8 rounded-2xl border border-[var(--editor-color-border)] bg-white p-6 shadow-sm"
          aria-labelledby="local-startup-title"
        >
          <h2 id="local-startup-title" className="text-base font-semibold">Open a local project for now</h2>
          <p className="mt-2 text-sm text-[color:var(--editor-color-text-secondary)]">
            Start Screenshot Studio with <code>screenshots dev --project …</code> or set <code>PROJECT_PATH</code>. App Home never asks you to paste that path into a web form.
          </p>
        </section>
      </section>
    </main>
  );
}
