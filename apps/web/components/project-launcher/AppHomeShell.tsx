// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { type ReactNode, type Ref } from "react";
import { FolderInput, Layers3, LoaderCircle, Plus, RotateCcw } from "lucide-react";
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

export interface AppHomeShellProps {
  state: LauncherImportState;
  creationState: ProjectCreationState;
  projectTemplates: readonly ProjectTemplateSummary[];
  dialogClosing: boolean;
  projects: ProjectLibraryState;
  projectAction: ProjectLibraryAction | null;
  projectActionError: string | null;
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
  onRemoveRecent,
}: AppHomeShellProps) {
  const dialogState = state.status === "idle" || state.status === "cancelled" ? null : state;
  const firstRun = projects.status === "ready" && projects.entries.length === 0;

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
        {firstRun ? <section aria-labelledby="first-project-title" className="mx-auto flex min-h-[34rem] max-w-2xl flex-col items-center justify-center text-center"><span className="grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-700"><Layers3 aria-hidden="true" className="size-7" /></span><h2 id="first-project-title" className="mt-6 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Create your first screenshot project</h2><p className="mt-4 max-w-xl text-base leading-7 text-slate-600">Start with a guided project or import an existing Screenshot Studio project into a safe managed copy.</p><p className="mt-6 text-sm text-slate-500">Use New project or Import above to get started.</p></section> : null}
        {projects.status === "ready" && projects.entries.length > 0 ? <ProjectGallery entries={projects.entries} action={projectAction} actionError={projectActionError} onOpen={onOpenProject} onOpenDetails={onOpenProjectDetails} onRemoveRecent={onRemoveRecent} /> : null}
      </div>

      {creationState.status !== "closed" ? <ProjectCreationDialog state={creationState} templates={projectTemplates} onClose={onCloseCreate} onChange={onChangeCreation} onSubmit={onSubmitCreation} /> : null}
      {dialogState ? <ProjectImportDialog state={dialogState} closing={dialogClosing} onClose={onCloseImport} onCancel={onCancelImport} onConfirm={onConfirmImport} onRetry={onRetryImport} onSelectSource={onSelectSource} onChooseCapture={onChooseCapture} /> : null}
      {captureDialog}
    </main>
  );
}
