// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { type ReactNode, type Ref } from "react";
import { CircleCheck, FolderInput, Layers3, LoaderCircle, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import type { ProjectTemplateSummary } from "@screenshot-studio/core/scaffold";
import { DEFAULT_STORE_SPECS, type StoreSpecs } from "@screenshot-studio/core/export";
import type { BrowserProjectImportSource } from "@web/lib/clients/project-import-client";
import { cx, editorUi } from "@web/components/editor-ui/styles";
import { agentCanRun } from "@web/components/agent-panel-model";
import type { AgentStatus } from "@web/lib/agents/agent-registry.server";
import type { AgentStartRequest } from "@web/lib/editor/agent-start-request";
import { launcherActions, type LauncherImportState } from "./project-launcher-model";
import { ProjectCreationDialog } from "./ProjectCreationDialog";
import type { ProjectCreationForm, ProjectCreationState } from "./project-creation-model";
import { ProjectImportDialog } from "./ProjectImportDialog";
import {
  ProjectGallery,
  type ProjectLibraryAction,
  type ProjectLibraryState,
} from "./ProjectGallery";
import type { ProjectLibraryNotice } from "./project-action-notice";

const launcherActionMotion = "transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-2 motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-60";
const firstRunActionMotion = "shadow-sm transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)] focus-visible:ring-offset-2 motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-60";

export interface AppHomeShellProps {
  state: LauncherImportState;
  creationState: ProjectCreationState;
  projectTemplates: readonly ProjectTemplateSummary[];
  storeSpecs?: StoreSpecs;
  dialogClosing: boolean;
  projects: ProjectLibraryState;
  projectAction: ProjectLibraryAction | null;
  projectActionError: string | null;
  projectActionNotice: ProjectLibraryNotice | null;
  projectToast?: ProjectLibraryNotice | null;
  leavingEntryId?: string | null;
  visibleOpeningEntryId: string | null;
  deletionDialog?: ReactNode;
  importButtonRef?: Ref<HTMLButtonElement>;
  creationButtonRef?: Ref<HTMLButtonElement>;
  captureDialog?: ReactNode;
  onOpenCreate(): void;
  onCloseCreate(): void;
  onChangeCreation(patch: Partial<ProjectCreationForm>): void;
  /** From `/api/agents`; agents that can run now are offered as a New project starting point. */
  agents?: readonly AgentStatus[];
  onSubmitCreation(agent?: AgentStartRequest): void;
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
  storeSpecs = DEFAULT_STORE_SPECS,
  dialogClosing,
  projects,
  projectAction,
  projectActionError,
  projectActionNotice,
  projectToast = null,
  leavingEntryId = null,
  visibleOpeningEntryId,
  deletionDialog,
  importButtonRef,
  creationButtonRef,
  captureDialog,
  onOpenCreate,
  onCloseCreate,
  onChangeCreation,
  onSubmitCreation,
  agents = [],
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
    {creationState.status !== "closed" ? <ProjectCreationDialog state={creationState} templates={projectTemplates} specs={storeSpecs} agents={agents.filter(agentCanRun)} onClose={onCloseCreate} onChange={onChangeCreation} onSubmit={onSubmitCreation} /> : null}
    {dialogState ? <ProjectImportDialog state={dialogState} closing={dialogClosing} onClose={onCloseImport} onCancel={onCancelImport} onConfirm={onConfirmImport} onRetry={onRetryImport} onSelectSource={onSelectSource} onChooseCapture={onChooseCapture} /> : null}
    {captureDialog}
    {deletionDialog}
  </>;
  // Stays mounted across the gallery/first-run swap so screen readers announce each new message.
  const toastRegion = <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
    {projectToast ? <p key={projectToast.entryId} data-motion={projectToast.motion} className="launcher-toast inline-flex max-w-lg items-center gap-2 rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-4 py-3 text-sm text-[color:var(--editor-color-text-default)] shadow-lg"><CircleCheck aria-hidden="true" className="size-4 shrink-0 text-[color:var(--editor-color-success-text)]" />{projectToast.message}</p> : null}
  </div>;

  if (firstRun) {
    return (<>
      {toastRegion}
      <main className="relative min-h-dvh overflow-hidden bg-[var(--editor-color-surface-subtle)] text-[color:var(--editor-color-text-default)]">
        <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--editor-color-accent)_14%,transparent),transparent_48%),radial-gradient(circle_at_top_right,color-mix(in_srgb,var(--editor-color-accent-gradient-end)_12%,transparent),transparent_42%)]" />
        <div className="relative mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-5 py-6 sm:px-8 sm:py-8 lg:px-12">
          <header className="flex items-center justify-between border-b border-[var(--editor-color-border)] pb-5">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-[var(--editor-color-accent)] text-[color:var(--editor-color-on-accent)] shadow-[var(--editor-shadow-accent)]"><Layers3 aria-hidden="true" className="size-5" /></span>
              <div><p className="font-semibold tracking-tight text-[color:var(--editor-color-text-strong)]">Screenshot Studio</p><p className="text-xs text-[color:var(--editor-color-text-muted)]">Project launcher</p></div>
            </div>
            <span className="hidden items-center gap-2 rounded-full border border-[var(--editor-color-success-border)] bg-[var(--editor-color-success-surface)] px-3 py-1.5 text-xs font-medium text-[color:var(--editor-color-success-text)] sm:inline-flex"><ShieldCheck aria-hidden="true" className="size-4" /> Local-first project workflow</span>
          </header>

          <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(34rem,1.1fr)] lg:gap-16 lg:py-16">
            <section aria-labelledby="app-home-title" className="max-w-xl">
              <p className={editorUi.sectionLabel}>App Home</p>
              <h1 id="app-home-title" className="mt-4 text-4xl font-semibold tracking-[-0.035em] text-[color:var(--editor-color-text-strong)] sm:text-5xl lg:text-6xl">Turn product moments into store-ready stories.</h1>
              <p className="mt-5 max-w-lg text-base leading-7 text-[color:var(--editor-color-text-secondary)] sm:text-lg">Create a fresh managed screenshot project from an empty canvas or a complete starter, or import an existing project into a safe managed copy.</p>
              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm text-[color:var(--editor-color-text-secondary)]">
                <span className="inline-flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4 text-[color:var(--editor-color-success-text)]" /> Strict validation</span>
                <span className="inline-flex items-center gap-2"><ShieldCheck aria-hidden="true" className="size-4 text-[color:var(--editor-color-success-text)]" /> Source stays untouched</span>
              </div>
            </section>

            <section aria-label="Project actions" className="grid gap-4 sm:grid-cols-2">
              <button ref={creationButtonRef} type="button" onClick={onOpenCreate} disabled={!launcherActions.createEnabled} aria-label="New project" aria-describedby="create-project-help" className={cx("group relative min-h-56 rounded-3xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-6 text-left hover:border-[var(--editor-color-accent-border-strong)]", firstRunActionMotion)}>
                <span className="grid size-11 place-items-center rounded-2xl bg-[var(--editor-color-accent-subtle)] text-[color:var(--editor-color-accent-text-strong)]"><Plus aria-hidden="true" className="size-5" /></span>
                <span className="mt-8 block text-xl font-semibold text-[color:var(--editor-color-text-strong)]">New project</span>
                <span id="create-project-help" className="mt-2 block text-sm leading-6 text-[color:var(--editor-color-text-secondary)]">Start from a guided store-ready project setup.</span>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-[color:var(--editor-color-accent-text-strong)]">Choose starting point <span aria-hidden="true">→</span></span>
              </button>
              <button ref={importButtonRef} type="button" onClick={onOpenImport} disabled={!launcherActions.importEnabled} aria-label="Import" className={cx("group min-h-56 rounded-3xl border border-[var(--editor-color-accent-border-strong)] bg-gradient-to-br from-[var(--editor-color-accent)] to-[var(--editor-color-accent-gradient-end)] p-6 text-left text-[color:var(--editor-color-on-accent)] shadow-blue-950/15", firstRunActionMotion)}>
                <span className="grid size-11 place-items-center rounded-2xl bg-[var(--editor-color-on-accent-subtle)]"><FolderInput aria-hidden="true" className="size-5" /></span>
                <span className="mt-8 block text-xl font-semibold">Import</span>
                <span className="mt-2 block text-sm leading-6 text-[color:var(--editor-color-on-accent)]">Choose a complete Folder, project ZIP, or eligible standalone JSON.</span>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold">Choose source <span aria-hidden="true">→</span></span>
              </button>
            </section>
          </div>

          {state.status === "cancelled" ? <p role="status" className="mb-5 rounded-xl bg-[var(--editor-color-surface)] px-4 py-3 text-sm text-[color:var(--editor-color-text-secondary)] ring-1 ring-[var(--editor-color-border)]">Import cancelled. Your previously active project was not changed.</p> : null}
        </div>
        {dialogs}
      </main>
    </>);
  }

  return (<>
    {toastRegion}
    <main className="min-h-dvh bg-[var(--editor-color-surface-subtle)] text-[color:var(--editor-color-text-default)]">
      <header className="border-b border-[var(--editor-color-border)] bg-[var(--editor-color-surface)]">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-12">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[var(--editor-color-accent)] text-[color:var(--editor-color-on-accent)] shadow-[var(--editor-shadow-accent)]"><Layers3 aria-hidden="true" className="size-5" /></span>
            <div className="flex items-baseline gap-2"><span className="font-semibold tracking-tight text-[color:var(--editor-color-text-strong)]">Screenshot Studio</span><span className="text-sm text-[color:var(--editor-color-text-subtle)]">/</span><span className="text-sm text-[color:var(--editor-color-text-muted)]">Projects</span></div>
          </div>
          <div className="flex items-center gap-2">
            <button ref={importButtonRef} type="button" onClick={onOpenImport} disabled={!launcherActions.importEnabled} className={cx(editorUi.buttonSecondary, launcherActionMotion)}><FolderInput aria-hidden="true" className="size-4" /> Import</button>
            <button ref={creationButtonRef} type="button" onClick={onOpenCreate} disabled={!launcherActions.createEnabled} className={cx(editorUi.buttonPrimary, launcherActionMotion)}><Plus aria-hidden="true" className="size-4" /> New project</button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-5 py-10 sm:px-8 lg:px-12 lg:py-12">
        <h1 className="sr-only">Projects</h1>
        {state.status === "cancelled" ? <p role="status" className="mb-5 rounded-xl bg-[var(--editor-color-surface)] px-4 py-3 text-sm text-[color:var(--editor-color-text-muted)] ring-1 ring-[var(--editor-color-border)]">Import cancelled. Your previously active project was not changed.</p> : null}

        {projects.status === "loading" ? <div role="status" className="flex min-h-[28rem] items-center justify-center gap-2 text-sm text-[color:var(--editor-color-text-secondary)]"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> Loading projects…</div> : null}
        {projects.status === "error" ? <div role="alert" className="mx-auto mt-20 max-w-lg rounded-2xl border border-[var(--editor-color-danger-border)] bg-[var(--editor-color-surface)] p-6 text-center"><p className="font-semibold text-[color:var(--editor-color-text-strong)]">Projects could not be loaded.</p><p className="mt-2 text-sm text-[color:var(--editor-color-danger-text)]">{projects.message}</p><button type="button" className={`mt-5 ${editorUi.buttonSecondary}`} onClick={onRetryProjects}><RotateCcw aria-hidden="true" className="size-4" /> Retry</button></div> : null}
        {projects.status === "ready" && projects.entries.length > 0 ? <ProjectGallery entries={projects.entries} specs={storeSpecs} action={projectAction} actionError={projectActionError} actionNotice={projectActionNotice} leavingEntryId={leavingEntryId} visibleOpeningEntryId={visibleOpeningEntryId} onOpen={onOpenProject} onOpenDetails={onOpenProjectDetails} onExportArchive={onExportArchive} onDeleteProject={onDeleteProject} onRemoveRecent={onRemoveRecent} /> : null}
      </div>

      {dialogs}
    </main>
  </>);
}
