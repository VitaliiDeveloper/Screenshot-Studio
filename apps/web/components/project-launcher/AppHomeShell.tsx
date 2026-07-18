// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { type Ref } from "react";
import { Clock3, FolderInput, Layers3, Plus, ShieldCheck } from "lucide-react";
import type { BrowserProjectImportSource } from "../../lib/project-import-client";
import { editorUi } from "../editor-ui/styles";
import { launcherActions, type LauncherImportState } from "./project-launcher-model";
import { ProjectImportDialog } from "./ProjectImportDialog";

export interface AppHomeShellProps {
  state: LauncherImportState;
  dialogClosing: boolean;
  sessionError: string | null;
  importButtonRef?: Ref<HTMLButtonElement>;
  onOpenImport(): void;
  onCloseImport(): void;
  onCancelImport(): void;
  onConfirmImport(): void;
  onRetryImport(): void;
  onSelectSource(source: BrowserProjectImportSource): void;
}

export function AppHomeShell({
  state,
  dialogClosing,
  sessionError,
  importButtonRef,
  onOpenImport,
  onCloseImport,
  onCancelImport,
  onConfirmImport,
  onRetryImport,
  onSelectSource,
}: AppHomeShellProps) {
  const dialogState = state.status === "idle" || state.status === "cancelled" ? null : state;

  return (
    <main className="min-h-dvh overflow-hidden bg-[var(--editor-color-surface-subtle)] text-[color:var(--editor-color-text-default)]">
      <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_48%),radial-gradient(circle_at_top_right,rgba(99,102,241,0.12),transparent_42%)]" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-slate-200/80 pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--editor-color-accent)] text-white shadow-[var(--editor-shadow-accent)]"><Layers3 aria-hidden="true" className="size-5" /></span>
            <div><p className="font-semibold tracking-tight text-[color:var(--editor-color-text-strong)]">Screenshot Studio</p><p className="text-xs text-[color:var(--editor-color-text-muted)]">Project launcher</p></div>
          </div>
          <span className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 sm:inline-flex"><ShieldCheck aria-hidden="true" className="size-4" /> Local-first project workflow</span>
        </header>

        <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(34rem,1.1fr)] lg:gap-16 lg:py-16">
          <section aria-labelledby="app-home-title" className="max-w-xl">
            <p className={editorUi.sectionLabel}>App Home</p>
            <h1 id="app-home-title" className="mt-4 text-4xl font-semibold tracking-[-0.035em] text-[color:var(--editor-color-text-strong)] sm:text-5xl lg:text-6xl">Turn product moments into store-ready stories.</h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-[color:var(--editor-color-text-secondary)] sm:text-lg">Create a fresh screenshot project in a later launcher step, or import an existing complete project into a safe managed copy today.</p>
            <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[color:var(--editor-color-text-secondary)]">
              <span className="inline-flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4 text-emerald-600" /> Strict validation</span>
              <span className="inline-flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4 text-emerald-600" /> Source stays untouched</span>
            </div>
          </section>

          <section aria-label="Project actions" className="grid gap-4 sm:grid-cols-2">
            <button type="button" disabled={!launcherActions.createEnabled} aria-describedby="create-project-help" className="relative min-h-56 rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-sm disabled:cursor-not-allowed disabled:opacity-75">
              <span className="grid size-11 place-items-center rounded-2xl bg-slate-100 text-slate-500"><Plus aria-hidden="true" className="size-5" /></span>
              <span className="mt-8 block text-xl font-semibold text-[color:var(--editor-color-text-strong)]">Create project</span>
              <span id="create-project-help" className="mt-2 block text-sm leading-6 text-[color:var(--editor-color-text-secondary)]">Start from a guided store-ready project setup.</span>
              <span className="mt-5 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Coming in Launcher 5</span>
            </button>
            <button ref={importButtonRef} type="button" onClick={onOpenImport} disabled={!launcherActions.importEnabled} className="group min-h-56 rounded-3xl border border-blue-300 bg-gradient-to-br from-blue-600 to-indigo-600 p-6 text-left text-white shadow-xl shadow-blue-950/15 transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-2xl active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-2 motion-reduce:transform-none">
              <span className="grid size-11 place-items-center rounded-2xl bg-white/15"><FolderInput aria-hidden="true" className="size-5" /></span>
              <span className="mt-8 block text-xl font-semibold">Import project</span>
              <span className="mt-2 block text-sm leading-6 text-blue-50">Choose a complete Folder, project ZIP, or eligible standalone JSON.</span>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold">Choose source <span aria-hidden="true">→</span></span>
            </button>
          </section>
        </div>

        {sessionError ? <p role="alert" className={`mb-5 ${editorUi.statusError}`}>{sessionError}</p> : null}
        {state.status === "cancelled" ? <p role="status" className="mb-5 rounded-xl bg-white px-4 py-3 text-sm text-[color:var(--editor-color-text-secondary)] ring-1 ring-slate-200">Import cancelled. Your previously active project was not changed.</p> : null}

        <section aria-labelledby="recent-projects-title" className="rounded-2xl border border-dashed border-slate-300 bg-white/55 px-5 py-4 sm:flex sm:items-center sm:justify-between">
          <div className="flex items-center gap-3"><Clock3 aria-hidden="true" className="size-5 text-slate-400" /><div><h2 id="recent-projects-title" className="font-semibold text-[color:var(--editor-color-text-strong)]">Recent projects</h2><p className="mt-0.5 text-sm text-[color:var(--editor-color-text-secondary)]">No recent projects yet.</p></div></div>
          <span className="mt-3 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 sm:mt-0">Arriving in Launcher 8</span>
        </section>
      </div>

      {dialogState ? <ProjectImportDialog state={dialogState} closing={dialogClosing} onClose={onCloseImport} onCancel={onCancelImport} onConfirm={onConfirmImport} onRetry={onRetryImport} onSelectSource={onSelectSource} /> : null}
    </main>
  );
}
