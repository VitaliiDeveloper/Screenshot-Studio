// SPDX-License-Identifier: Apache-2.0
"use client";

import React from "react";
import { Download, LoaderCircle, ShieldAlert, Trash2 } from "lucide-react";
import type { ProjectDeletionRequest } from "@web/lib/clients/project-delete-client.js";
import { DialogShell } from "@web/components/editor-ui/DialogShell.js";
import { editorUi } from "@web/components/editor-ui/styles.js";

type DeletionBackup = ProjectDeletionRequest["backup"];

export type ProjectDeletionDialogState =
  | { status: "choosing-backup" }
  | { status: "exporting" }
  | { status: "archive-error"; error: string }
  | { status: "confirming"; backup: DeletionBackup }
  | { status: "deleting" }
  | { status: "deletion-error"; error: string };

export function ProjectDeletionDialog({
  projectName,
  state,
  confirmation,
  acknowledged,
  onConfirmationChange,
  onAcknowledgedChange,
  onExportArchive,
  onContinueWithoutArchive,
  onConfirmDelete,
  onRetryDeletion,
  onClose,
}: {
  projectName: string;
  state: ProjectDeletionDialogState;
  confirmation: string;
  acknowledged: boolean;
  onConfirmationChange(value: string): void;
  onAcknowledgedChange(value: boolean): void;
  onExportArchive(): void;
  onContinueWithoutArchive(): void;
  onConfirmDelete(): void;
  onRetryDeletion(): void;
  onClose(): void;
}) {
  const busy = state.status === "exporting" || state.status === "deleting";
  const canDelete = state.status === "confirming"
    && confirmation === projectName
    && acknowledged;

  return (
    <DialogShell
      title="Permanently delete project"
      description="This deletes the managed project and all project-local resources. It cannot be recovered."
      closeLabel="Cancel permanent deletion"
      closeDisabled={busy}
      initialFocus="heading"
      onClose={onClose}
    >
      {state.status === "choosing-backup" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" className={`${editorUi.resourceCard} text-left`} onClick={onExportArchive}>
              <Download aria-hidden="true" className="size-5 text-[color:var(--editor-color-accent)]" />
              <span className="mt-3 block text-sm font-semibold text-[color:var(--editor-color-text-strong)]">Export archive, then continue</span>
              <span className="mt-1 block text-xs leading-5 text-[color:var(--editor-color-text-secondary)]">Create the existing portable project archive before confirmation.</span>
            </button>
            <button type="button" className={`${editorUi.resourceCard} text-left`} onClick={onContinueWithoutArchive}>
              <Trash2 aria-hidden="true" className="size-5 text-[color:var(--editor-color-danger)]" />
              <span className="mt-3 block text-sm font-semibold text-[color:var(--editor-color-danger)]">Continue without an archive</span>
              <span className="mt-1 block text-xs leading-5 text-[color:var(--editor-color-text-secondary)]">Proceed knowing there will be no recovery copy.</span>
            </button>
          </div>
          <div className="flex justify-end"><button type="button" className={editorUi.buttonSecondary} onClick={onClose}>Cancel</button></div>
        </div>
      ) : null}

      {state.status === "exporting" ? (
        <div className={editorUi.statusProgress}>
          <LoaderCircle aria-hidden="true" className="mr-2 inline size-4 animate-spin motion-reduce:animate-none" />
          Preparing the project archive. Deletion has not started.
        </div>
      ) : null}

      {state.status === "archive-error" ? (
        <div className="space-y-4">
          <p role="alert" className={editorUi.statusError}>Archive export failed. Deletion has not started: {state.error}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={editorUi.buttonSecondary} onClick={onClose}>Cancel</button>
            <button type="button" className={editorUi.buttonSecondary} onClick={onContinueWithoutArchive}>Continue without an archive</button>
            <button type="button" className={editorUi.buttonPrimary} onClick={onExportArchive}>Retry archive export</button>
          </div>
        </div>
      ) : null}

      {state.status === "confirming" ? (
        <div className="space-y-4">
          <div className={editorUi.statusWarning}>
            <ShieldAlert aria-hidden="true" className="mr-2 inline size-4" />
            {state.backup.kind === "archive"
              ? "Archive export requested. Confirm only after your browser has started the download."
              : "You explicitly chose to continue without an archive."}
          </div>
          <label className="block text-sm font-medium text-[color:var(--editor-color-text-strong)]">
            Type {projectName} to confirm
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              className={`mt-2 ${editorUi.field}`}
              value={confirmation}
              onChange={(event) => onConfirmationChange(event.target.value)}
            />
          </label>
          <label className="flex items-start gap-3 text-sm text-[color:var(--editor-color-text-default)]">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-[var(--editor-color-border)]"
              checked={acknowledged}
              onChange={(event) => onAcknowledgedChange(event.target.checked)}
            />
            <span>I understand this project cannot be recovered.</span>
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={editorUi.buttonSecondary} onClick={onClose}>Cancel</button>
            <button type="button" className={editorUi.buttonDanger} disabled={!canDelete} onClick={onConfirmDelete}>Permanently delete project</button>
          </div>
        </div>
      ) : null}

      {state.status === "deleting" ? (
        <div className={editorUi.statusProgress}>
          <LoaderCircle aria-hidden="true" className="mr-2 inline size-4 animate-spin motion-reduce:animate-none" />
          Permanently deleting the project and verifying completion…
        </div>
      ) : null}

      {state.status === "deletion-error" ? (
        <div className="space-y-4">
          <p role="alert" className={editorUi.statusError}>Permanent deletion could not be verified: {state.error}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={editorUi.buttonSecondary} onClick={onClose}>Cancel</button>
            <button type="button" className={editorUi.buttonDanger} onClick={onRetryDeletion}>Retry permanent deletion</button>
          </div>
        </div>
      ) : null}
    </DialogShell>
  );
}
