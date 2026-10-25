// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useRef, type ChangeEvent } from "react";
import { FileArchive, FileJson, FolderOpen, Images, LoaderCircle } from "lucide-react";
import type { BrowserProjectImportSource } from "@web/lib/clients/project-import-client";
import { DialogShell, editorUi } from "@web/components/editor-ui";
import type { LauncherImportState } from "./project-launcher-model";

export interface ProjectImportDialogProps {
  state: Exclude<LauncherImportState, { status: "idle" | "cancelled" }>;
  closing: boolean;
  onClose(): void;
  onCancel(): void;
  onConfirm(): void;
  onRetry(): void;
  onSelectSource(source: BrowserProjectImportSource): void;
  onChooseCapture(): void;
}

export function ProjectImportDialog({
  state,
  closing,
  onClose,
  onCancel,
  onConfirm,
  onRetry,
  onSelectSource,
  onChooseCapture,
}: ProjectImportDialogProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const chooseFolder = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length > 0) onSelectSource({ kind: "folder", files });
  };
  const chooseSingle = (kind: "archive" | "json") => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) onSelectSource({ kind, file });
  };

  const title = state.status === "confirming"
    ? "Import a managed copy?"
    : "Bring an existing project into Screenshot Studio";
  const requestClose = state.status === "uploading" ? onCancel : onClose;

  return (
    <DialogShell
      title={title}
      description="Your selection is validated and copied into managed storage. Screenshot Studio never edits the selected Folder, ZIP, or JSON file in place."
      onClose={requestClose}
      closeLabel="Close project import"
      closeDisabled={closing || state.status === "publishing"}
      initialFocus="heading"
      focusResetKey={state.status}
      widthClass="max-w-2xl"
      motion={closing ? "closing" : "open"}
    >
      <div key={state.status} className="launcher-dialog-state">
        {state.status === "choosing" ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--editor-color-text-muted)]">Project folder or archive</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <button type="button" onClick={() => folderInputRef.current?.click()} className="group flex h-full flex-col items-start justify-start rounded-2xl border-2 border-[var(--editor-color-accent-muted)] bg-[var(--editor-color-accent-subtle)] p-5 text-left transition hover:border-[var(--editor-color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]">
              <span className="inline-flex items-center gap-2 text-base font-semibold text-[color:var(--editor-color-text-strong)]">
                <FolderOpen aria-hidden="true" className="size-5 text-[color:var(--editor-color-accent-text)]" /> Folder
              </span>
              <span className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[color:var(--editor-color-accent-text)]">Recommended</span>
              <span className="mt-2 block text-sm leading-5 text-[color:var(--editor-color-text-secondary)]">Best for complete projects with screenshots, fonts, and assets.</span>
              <span className="mt-3 block text-xs leading-5 text-[color:var(--editor-color-text-muted)]">Your browser may ask you to confirm uploading the selected files.</span>
            </button>
            <button type="button" onClick={() => archiveInputRef.current?.click()} className="flex h-full flex-col items-start justify-start rounded-2xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-5 text-left transition hover:border-[var(--editor-color-border-strong)] hover:bg-[var(--editor-color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]">
              <span className="inline-flex items-center gap-2 text-base font-semibold text-[color:var(--editor-color-text-strong)]"><FileArchive aria-hidden="true" className="size-5" /> Project ZIP</span>
              <span className="mt-7 block text-sm leading-5 text-[color:var(--editor-color-text-secondary)]">Import a portable project archive with its referenced resources.</span>
            </button>
            <button type="button" onClick={() => jsonInputRef.current?.click()} className="flex h-full flex-col items-start justify-start rounded-2xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-5 text-left transition hover:border-[var(--editor-color-border-strong)] hover:bg-[var(--editor-color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]">
              <span className="inline-flex items-center gap-2 text-base font-semibold text-[color:var(--editor-color-text-strong)]"><FileJson aria-hidden="true" className="size-5" /> Standalone JSON</span>
              <span className="mt-7 block text-sm leading-5 text-[color:var(--editor-color-text-secondary)]">Eligible only when the project has no referenced local resources.</span>
            </button>
            </div>
            <div className="my-5 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-[color:var(--editor-color-text-muted)]"><span className="h-px flex-1 bg-[var(--editor-color-border)]" />or<span className="h-px flex-1 bg-[var(--editor-color-border)]" /></div>
            <button type="button" onClick={onChooseCapture} className="flex w-full items-start gap-4 rounded-2xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] p-5 text-left transition hover:border-[var(--editor-color-accent-muted)] hover:bg-[var(--editor-color-accent-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--editor-color-accent-subtle)] text-[color:var(--editor-color-accent-text)]"><Images aria-hidden="true" className="size-5" /></span>
              <span><span className="block text-base font-semibold text-[color:var(--editor-color-text-strong)]">Capture folder</span><span className="mt-1 block text-sm leading-5 text-[color:var(--editor-color-text-secondary)]">Create a project from a folder of screenshots and review the detected screens before importing.</span></span>
            </button>
            <input
              ref={(node) => {
                folderInputRef.current = node;
                node?.setAttribute("webkitdirectory", "");
              }}
              type="file"
              multiple
              tabIndex={-1}
              aria-label="Choose project folder"
              className="sr-only"
              onChange={chooseFolder}
            />
            <input ref={archiveInputRef} type="file" tabIndex={-1} accept=".zip,application/zip" aria-label="Choose project ZIP" className="sr-only" onChange={chooseSingle("archive")} />
            <input ref={jsonInputRef} type="file" tabIndex={-1} accept=".json,application/json" aria-label="Choose standalone project JSON" className="sr-only" onChange={chooseSingle("json")} />
          </div>
        ) : null}

        {state.status === "confirming" ? (
          <div className="rounded-2xl border border-[var(--editor-color-accent-muted)] bg-[var(--editor-color-accent-subtle)] p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--editor-color-accent-text)]">
              {state.kind === "folder" ? "Folder selected" : state.kind === "archive" ? "Project ZIP selected" : "Standalone JSON selected"}
            </p>
            <p className="mt-2 text-sm leading-6 text-[color:var(--editor-color-text-secondary)]">
              {state.kind === "folder" ? "Your original folder stays unchanged." : "Your original file stays unchanged."} Screenshot Studio will validate the selection, copy it into managed storage on this host, and open the managed project in Workspace.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" className={editorUi.buttonPrimary} onClick={onConfirm}>Import managed copy</button>
              <button type="button" className={editorUi.buttonSecondary} onClick={onRetry}>Choose another source</button>
            </div>
            {state.kind === "folder" ? (
              <details className="mt-5 border-t border-[var(--editor-color-accent-muted)] pt-4 text-sm text-[color:var(--editor-color-text-secondary)]">
                <summary className="cursor-pointer font-semibold text-[color:var(--editor-color-text-strong)]">Want to work in this exact local folder?</summary>
                <p className="mt-2 leading-6">
                  A browser cannot pass a trusted server filesystem path, even on localhost. Start the local host with <code className="rounded bg-[var(--editor-color-surface)] px-1.5 py-0.5 text-xs">PROJECT_PATH=/absolute/.../app-store-screenshots.json pnpm dev</code> or <code className="rounded bg-[var(--editor-color-surface)] px-1.5 py-0.5 text-xs">screenshots dev --project /absolute/.../app-store-screenshots.json</code> to work in place.
                </p>
              </details>
            ) : null}
          </div>
        ) : null}

        {state.status === "uploading" || state.status === "publishing" ? (
          <div className="rounded-2xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] p-5" role="status" aria-live="polite">
            <div className="flex items-start gap-3">
              <LoaderCircle aria-hidden="true" className="mt-0.5 size-5 animate-spin text-[color:var(--editor-color-accent-text)] motion-reduce:animate-none" />
              <div>
                <p className="font-semibold text-[color:var(--editor-color-text-strong)]">
                  {state.status === "uploading" ? "Uploading your selection…" : "Validating and publishing your managed copy…"}
                </p>
                <p className="mt-1 text-sm text-[color:var(--editor-color-text-secondary)]">
                  {state.status === "uploading" ? "You can cancel while browser transfer is still in progress." : "Atomic publication has started. Keep this window open for a moment."}
                </p>
              </div>
            </div>
            {state.status === "uploading" ? <button type="button" className={`mt-4 ${editorUi.buttonSecondary}`} onClick={onCancel}>Cancel import</button> : null}
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className={editorUi.statusError} role="alert">
            <p className="font-semibold">Import could not be completed</p>
            <p className="mt-1">{state.message}</p>
            {state.missingResources.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5">
                {state.missingResources.map((path) => <li key={path} className="break-all">{path}</li>)}
              </ul>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className={editorUi.buttonPrimary} onClick={onRetry}>Try another source</button>
              <button type="button" className={editorUi.buttonSecondary} onClick={onClose}>Close</button>
            </div>
          </div>
        ) : null}
      </div>
    </DialogShell>
  );
}
