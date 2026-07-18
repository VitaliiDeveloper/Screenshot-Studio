// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useEffect, useId, useRef, type ChangeEvent } from "react";
import { FileArchive, FileJson, FolderOpen, LoaderCircle, X } from "lucide-react";
import type { BrowserProjectImportSource } from "../../lib/project-import-client";
import { editorUi } from "../editor-ui/styles";
import type { LauncherImportState } from "./project-launcher-model";

export interface ProjectImportDialogProps {
  state: Exclude<LauncherImportState, { status: "idle" | "cancelled" }>;
  onClose(): void;
  onCancel(): void;
  onConfirm(): void;
  onRetry(): void;
  onSelectSource(source: BrowserProjectImportSource): void;
}

export function ProjectImportDialog({
  state,
  onClose,
  onCancel,
  onConfirm,
  onRetry,
  onSelectSource,
}: ProjectImportDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [state.status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state.status !== "publishing") {
        event.preventDefault();
        if (state.status === "uploading") onCancel();
        else onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled])',
      ) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        headingRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || activeElement === headingRef.current
        || !dialogRef.current?.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last
        || !dialogRef.current?.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel, onClose, state.status]);

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

  return (
    <div className="launcher-dialog-backdrop fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="launcher-dialog-panel max-h-[min(44rem,calc(100dvh-2rem))] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/60 bg-white p-5 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={editorUi.sectionLabel}>Import project</p>
            <h2
              ref={headingRef}
              tabIndex={-1}
              id={titleId}
              className="mt-2 text-2xl font-semibold tracking-tight text-[color:var(--editor-color-text-strong)] outline-none"
            >
              {state.status === "confirming"
                ? "Import a managed copy?"
                : "Bring an existing project into Screenshot Studio"}
            </h2>
          </div>
          {state.status !== "publishing" ? (
            <button type="button" aria-label="Close project import" className={editorUi.iconButton} onClick={state.status === "uploading" ? onCancel : onClose}>
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
        <p id={descriptionId} className="mt-3 text-sm leading-6 text-[color:var(--editor-color-text-secondary)]">
          Your selection is validated and copied into managed storage. Screenshot Studio never claims to edit the selected Folder, ZIP, or JSON file in place.
        </p>

        {state.status === "choosing" ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <button type="button" onClick={() => folderInputRef.current?.click()} className="group rounded-2xl border-2 border-[var(--editor-color-accent-muted)] bg-[var(--editor-color-accent-subtle)] p-5 text-left transition hover:border-[var(--editor-color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]">
              <span className="inline-flex items-center gap-2 text-base font-semibold text-[color:var(--editor-color-text-strong)]">
                <FolderOpen aria-hidden="true" className="size-5 text-[color:var(--editor-color-accent)]" /> Folder
              </span>
              <span className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[color:var(--editor-color-accent)]">Recommended</span>
              <span className="mt-2 block text-sm leading-5 text-[color:var(--editor-color-text-secondary)]">Best for complete projects with screenshots, fonts, and assets.</span>
            </button>
            <button type="button" onClick={() => archiveInputRef.current?.click()} className="rounded-2xl border border-[var(--editor-color-border)] bg-white p-5 text-left transition hover:border-[var(--editor-color-border-strong)] hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]">
              <span className="inline-flex items-center gap-2 text-base font-semibold text-[color:var(--editor-color-text-strong)]"><FileArchive aria-hidden="true" className="size-5" /> Project ZIP</span>
              <span className="mt-7 block text-sm leading-5 text-[color:var(--editor-color-text-secondary)]">Import a portable project archive with its referenced resources.</span>
            </button>
            <button type="button" onClick={() => jsonInputRef.current?.click()} className="rounded-2xl border border-[var(--editor-color-border)] bg-white p-5 text-left transition hover:border-[var(--editor-color-border-strong)] hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--editor-color-focus)]">
              <span className="inline-flex items-center gap-2 text-base font-semibold text-[color:var(--editor-color-text-strong)]"><FileJson aria-hidden="true" className="size-5" /> Standalone JSON</span>
              <span className="mt-7 block text-sm leading-5 text-[color:var(--editor-color-text-secondary)]">Eligible only when the project has no referenced local resources.</span>
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
          <div className="mt-6 rounded-2xl border border-[var(--editor-color-accent-muted)] bg-[var(--editor-color-accent-subtle)] p-5 sm:p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--editor-color-accent)]">
              {state.kind === "folder" ? "Folder selected" : state.kind === "archive" ? "Project ZIP selected" : "Standalone JSON selected"}
            </p>
            <p className="mt-2 text-sm leading-6 text-[color:var(--editor-color-text-secondary)]">
              {state.kind === "folder" ? "Your original folder stays unchanged." : "Your original file stays unchanged."} Screenshot Studio will validate the selection, copy it into managed storage on this host, and open the managed project on Project Home.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button type="button" className={editorUi.buttonPrimary} onClick={onConfirm}>Import managed copy</button>
              <button type="button" className={editorUi.buttonSecondary} onClick={onRetry}>Choose another source</button>
            </div>
            {state.kind === "folder" ? (
              <details className="mt-5 border-t border-blue-200 pt-4 text-sm text-[color:var(--editor-color-text-secondary)]">
                <summary className="cursor-pointer font-semibold text-[color:var(--editor-color-text-strong)]">Want to work in this exact local folder?</summary>
                <p className="mt-2 leading-6">
                  A browser cannot pass a trusted server filesystem path, even on localhost. Start the local host with <code className="rounded bg-white px-1.5 py-0.5 text-xs">PROJECT_PATH=/absolute/.../app-store-screenshots.json pnpm dev</code> or <code className="rounded bg-white px-1.5 py-0.5 text-xs">screenshots dev --project /absolute/.../app-store-screenshots.json</code> to work in place.
                </p>
              </details>
            ) : null}
          </div>
        ) : null}

        {state.status === "uploading" || state.status === "publishing" ? (
          <div className="mt-7 rounded-2xl border border-[var(--editor-color-border)] bg-slate-50 p-5" role="status" aria-live="polite">
            <div className="flex items-start gap-3">
              <LoaderCircle aria-hidden="true" className="mt-0.5 size-5 animate-spin text-[color:var(--editor-color-accent)] motion-reduce:animate-none" />
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
          <div className={`mt-7 ${editorUi.statusError}`} role="alert">
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
      </section>
    </div>
  );
}
