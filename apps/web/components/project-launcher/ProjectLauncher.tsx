// SPDX-License-Identifier: Apache-2.0
"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FolderOpen } from "lucide-react";
import { editorUi } from "../editor-ui/styles";
import { fetchActiveProject, openLocalProject } from "../../lib/project-session";
import { switchActiveProject } from "../../lib/debounced-save";

export function ProjectLauncher({ allowSwitch }: { allowSwitch: boolean }) {
  const router = useRouter();
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!path.trim() || opening) return;
    setOpening(true);
    setError(null);
    try {
      await switchActiveProject(() => openLocalProject(path.trim()));
      router.push("/home");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setOpening(false);
    }
  }

  return (
    <main className="min-h-dvh bg-[var(--editor-color-surface-subtle)] px-6 py-12">
      <section className="mx-auto max-w-3xl">
        <p className={editorUi.sectionLabel}>Screenshot Studio</p>
        <h1 className="mt-3 flex items-center gap-3 text-4xl font-semibold text-[color:var(--editor-color-text-strong)]">
          <FolderOpen aria-hidden="true" className="size-9 text-[color:var(--editor-color-accent)]" />
          Open a screenshot project
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-[color:var(--editor-color-text-secondary)]">
          Select the existing app-store-screenshots.json on this computer. The editor validates it before changing the active project.
        </p>
        <form onSubmit={submit} className="mt-8 rounded-2xl border border-[var(--editor-color-border)] bg-white p-6 shadow-sm">
          <label htmlFor="project-path" className="text-sm font-semibold">Project file path</label>
          <input
            id="project-path"
            className={`mt-2 ${editorUi.field}`}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/Users/alex/Projects/MyApp/app-store-screenshots.json"
            autoComplete="off"
            aria-describedby="project-path-help"
          />
          <p id="project-path-help" className="mt-2 text-xs text-[color:var(--editor-color-text-secondary)]">
            Choose the project JSON itself, not only its containing directory.
          </p>
          {error ? <p role="alert" className={`mt-4 ${editorUi.statusError}`}>{error}</p> : null}
          <button className={`mt-5 ${editorUi.buttonPrimary}`} disabled={!path.trim() || opening}>
            {opening ? "Opening project…" : "Open project"}
            {!opening ? <ArrowRight aria-hidden="true" className="size-4" /> : null}
          </button>
        </form>
      </section>
    </main>
  );
}
