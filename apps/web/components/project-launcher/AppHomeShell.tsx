// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { type ReactNode, type Ref } from "react";
import { FolderInput, Layers3, LoaderCircle, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import type { ProjectTemplateSummary } from "@screenshot-studio/core/scaffold";
import type { BrowserProjectImportSource } from "../../lib/project-import-client";
import { cx, editorUi } from "../editor-ui/styles";
import { launcherActions, type LauncherImportState } from "./project-launcher-model";
import { ProjectCreationDialog } from "./ProjectCreationDialog";
import type { ProjectCreationForm, ProjectCreationState } from "./project-creation-model";
import { ProjectImportDialog } from "./ProjectImportDialog";
import {
  ProjectGallery,
  type ProjectLibraryAction,
  type ProjectLibraryState,
} from "./ProjectGallery";

const launcherActionMotion = "transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-2 motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-60";
const firstRunActionMotion = "shadow-sm transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-2 motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-60";

export interface AppHomeShellProps {
  state: LauncherImportState;
  creationState: ProjectCreationState;
  projectTemplates: readonly ProjectTemplateSummary[];
  dialogClosing: boolean;
  projects: ProjectLibraryState;
  projectAction: ProjectLibraryAction | null;
  projectActionError: string | null;
  visibleOpeningEntryId: string | null;
  deletionDialog?: ReactNode;
  importButtonRef?: Ref<HTMLButtonElement>;
  creationButtonRef?: Ref<HTMLButtonElement>;
  captureDialog?: ReactNode;
  onOpenCreate(): void;
  onCloseCreate(): void;
  onChangeCreation(patch: Partial<ProjectCreationForm>): void;
  onSubmitCreation(): void;
  onOpenImport(): void;
  onCloseImport(): void;
  onCancelImport(): void;
  onConfirmImport(): void;
  onRetryImport(): void;
  onSelectSource(source: BrowserProjectImportSource): void;
  onChooseCapture(): void;
  onRetryProjects(): void;
  onOpenProject(entryId: string): void;
  onOpenProjectDetails(entryId: string): void;
  onExportArchive(entryId: string): void;
  onDeleteProject(entryId: string): void;
  onRemoveRecent(entryId: string): void;
}

export function AppHomeShell({
  state,
  creationState,
  projectTemplates,
  dialogClosing,
  projects,
  projectAction,
  projectActionError,
  visibleOpeningEntryId,
  deletionDialog,
  importButtonRef,
  creationButtonRef,
  captureDialog,
  onOpenCreate,
  onCloseCreate,
  onChangeCreation,
  onSubmitCreation,
  onOpenImport,
  onCloseImport,
  onCancelImport,
  onConfirmImport,
  onRetryImport,
  onSelectSource,
  onChooseCapture,
  onRetryProjects,
  onOpenProject,
  onOpenProjectDetails,
  onExportArchive,
  onDeleteProject,
  onRemoveRecent,
}: AppHomeShellProps) {
  const dialogState = state.status === "idle" || state.status === "cancelled" ? null : state;
  const firstRun = projects.status === "ready" && projects.entries.length === 0;
  const dialogs = <>
    {creationState.status !== "closed" ? <ProjectCreationDialog state={creationState} templates={projectTemplates} onClose={onCloseCreate} onChange={onChangeCreation} onSubmit={onSubmitCreation} /> : null}
    {dialogState ? <ProjectImportDialog state={dialogState} closing={dialogClosing} onClose={onCloseImport} onCancel={onCancelImport} onConfirm={onConfirmImport} onRetry={onRetryImport} onSelectSource={onSelectSource} onChooseCapture={onChooseCapture} /> : null}
    {captureDialog}
    {deletionDialog}
  </>;

  if (firstRun) {
    return (
      <main className="relative min-h-dvh overflow-hidden bg-[var(--editor-color-surface-subtle)] text-[color:var(--editor-color-text-default)]">
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
              <p className="mt-5 max-w-lg text-base leading-7 text-[color:var(--editor-color-text-secondary)] sm:text-lg">Create a fresh managed screenshot project from an empty canvas or a complete starter, or import an existing project into a safe managed copy.</p>
              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[color:var(--editor-color-text-secondary)]">
                <span className="inline-flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4 text-emerald-600" /> Strict validation</span>
                <span className="inline-flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4 text-emerald-600" /> Source stays untouched</span>
              </div>
            </section>

            <section aria-label="Project actions" className="grid gap-4 sm:grid-cols-2">
              <button ref={creationButtonRef} type="button" onClick={onOpenCreate} disabled={!launcherActions.createEnabled} aria-label="New project" aria-describedby="create-project-help" className={cx("group relative min-h-56 rounded-3xl border border-slate-200 bg-white p-6 text-left hover:border-blue-300", firstRunActionMotion)}>
                <span className="grid size-11 place-items-center rounded-2xl bg-blue-50 text-blue-700"><Plus aria-hidden="true" className="size-5" /></span>
                <span className="mt-8 block text-xl font-semibold text-[color:var(--editor-color-text-strong)]">New project</span>
                <span id="create-project-help" className="mt-2 block text-sm leading-6 text-[color:var(--editor-color-text-secondary)]">Start from a guided store-ready project setup.</span>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-blue-700">Choose starting point <span aria-hidden="true">→</span></span>
              </button>
              <button ref={importButtonRef} type="button" onClick={onOpenImport} disabled={!launcherActions.importEnabled} aria-label="Import" className={cx("group min-h-56 rounded-3xl border border-blue-300 bg-gradient-to-br from-blue-600 to-indigo-600 p-6 text-left text-white shadow-blue-950/15", firstRunActionMotion)}>
                <span className="grid size-11 place-items-center rounded-2xl bg-white/15"><FolderInput aria-hidden="true" className="size-5" /></span>
                <span className="mt-8 block text-xl font-semibold">Import</span>
                <span className="mt-2 block text-sm leading-6 text-blue-50">Choose a complete Folder, project ZIP, or eligible standalone JSON.</span>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold">Choose source <span aria-hidden="true">→</span></span>
              </button>
            </section>
          </div>

          {state.status === "cancelled" ? <p role="status" className="mb-5 rounded-xl bg-white px-4 py-3 text-sm text-[color:var(--editor-color-text-secondary)] ring-1 ring-slate-200">Import cancelled. Your previously active project was not changed.</p> : null}
        </div>
        {dialogs}
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[var(--editor-color-surface-subtle)] text-[color:var(--editor-color-text-default)]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-12">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--editor-color-accent)] text-white shadow-[var(--editor-shadow-accent)]"><Layers3 aria-hidden="true" className="size-5" /></span>
            <div className="flex items-baseline gap-2"><span className="font-semibold tracking-tight text-slate-950">Screenshot Studio</span><span className="text-sm text-slate-400">/</span><span className="text-sm text-slate-600">Projects</span></div>
          </div>
          <div className="flex items-center gap-2">
            <button ref={importButtonRef} type="button" onClick={onOpenImport} disabled={!launcherActions.importEnabled} className={cx(editorUi.buttonSecondary, launcherActionMotion)}><FolderInput aria-hidden="true" className="size-4" /> Import</button>
            <button ref={creationButtonRef} type="button" onClick={onOpenCreate} disabled={!launcherActions.createEnabled} className={cx(editorUi.buttonPrimary, launcherActionMotion)}><Plus aria-hidden="true" className="size-4" /> New project</button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-5 py-10 sm:px-8 lg:px-12 lg:py-12">
        <h1 className="sr-only">Projects</h1>
        {state.status === "cancelled" ? <p role="status" className="mb-5 rounded-xl bg-white px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">Import cancelled. Your previously active project was not changed.</p> : null}

        {projects.status === "loading" ? <div role="status" className="flex min-h-[28rem] items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> Loading projects…</div> : null}
        {projects.status === "error" ? <div role="alert" className="mx-auto mt-20 max-w-lg rounded-2xl border border-red-200 bg-white p-6 text-center"><p className="font-semibold text-slate-950">Projects could not be loaded.</p><p className="mt-2 text-sm text-red-700">{projects.message}</p><button type="button" className={`mt-5 ${editorUi.buttonSecondary}`} onClick={onRetryProjects}><RotateCcw aria-hidden="true" className="size-4" /> Retry</button></div> : null}
        {projects.status === "ready" && projects.entries.length > 0 ? <ProjectGallery entries={projects.entries} action={projectAction} actionError={projectActionError} visibleOpeningEntryId={visibleOpeningEntryId} onOpen={onOpenProject} onOpenDetails={onOpenProjectDetails} onExportArchive={onExportArchive} onDeleteProject={onDeleteProject} onRemoveRecent={onRemoveRecent} /> : null}
      </div>

      {dialogs}
    </main>
  );
}
