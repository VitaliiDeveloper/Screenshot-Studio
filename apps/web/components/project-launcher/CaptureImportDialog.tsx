// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useRef, type ChangeEvent } from "react";
import {
  AlertTriangle,
  FileImage,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import type { CanvasMode, Platform } from "@screenshot-studio/core/model";
import { DialogShell } from "../editor-ui/DialogShell";
import { MenuSelect, type MenuSelectOption } from "../editor-ui/MenuSelect";
import { editorUi } from "../editor-ui/styles";
import {
  canApplyCaptureImport,
  canPreviewCaptureImport,
  type CaptureImportDraft,
  type CaptureImportState,
} from "./capture-import-model";

const PREVIEW_ITEM_LIMIT = 50;

const PLATFORM_OPTIONS: readonly MenuSelectOption<Platform>[] = [
  { value: "apple", label: "Apple App Store" },
  { value: "android", label: "Google Play" },
  { value: "windows", label: "Microsoft Store" },
];

const LAYOUT_MODE_OPTIONS: readonly MenuSelectOption<CanvasMode>[] = [
  { value: "isolated", label: "Isolated screens" },
  { value: "connected", label: "Connected strip" },
];

type OpenCaptureImportState = Exclude<CaptureImportState, { status: "closed" }>;

export interface CaptureImportDialogProps {
  state: OpenCaptureImportState;
  onClose(): void;
  onSelectFiles(files: readonly File[]): void;
  onChooseDestination(kind: "current-project" | "new-project"): void;
  onChooseCurrentLayout(layoutId: string): void;
  onChangeNewProject(patch: Partial<CaptureImportDraft["newProject"]>): void;
  onPreview(): void;
  onApply(): void;
  onCancel(): void;
  onRetry(): void;
  onRecoverStale(): void;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function MoreItems({ total, shown }: { total: number; shown: number }) {
  return total > shown ? (
    <p className="mt-2 text-xs text-[color:var(--editor-color-text-muted)]">
      {total - shown} more item{total - shown === 1 ? "" : "s"} are included in this plan.
    </p>
  ) : null;
}

function CapturePreview({ state }: { state: Extract<OpenCaptureImportState, { status: "reviewing" | "applying" }> }) {
  const { preview } = state;
  const screens = preview.screens.slice(0, PREVIEW_ITEM_LIMIT);
  const resources = preview.resources.slice(0, PREVIEW_ITEM_LIMIT);
  const warnings = preview.warnings.slice(0, PREVIEW_ITEM_LIMIT);
  const invalidEntries = preview.invalidEntries.slice(0, PREVIEW_ITEM_LIMIT);
  return (
    <div className="space-y-5">
      <section aria-labelledby="capture-receiver" className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 sm:p-5">
        <p className={editorUi.sectionLabel}>Planned receiver</p>
        <h3 id="capture-receiver" className="mt-2 font-semibold text-[color:var(--editor-color-text-strong)]">
          {preview.receiving.projectName}
        </h3>
        <p className="mt-1 text-sm text-[color:var(--editor-color-text-secondary)]">
          {preview.receiving.kind === "new-project" ? "New managed project" : "Current project"}
          {" · Layout: "}{preview.receiving.layoutName}
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-700">
          {[plural(preview.summary.screenCount, "screen"), plural(preview.summary.assetCount, "related asset")]
            .map((label) => <span key={label} className="rounded-full bg-white px-2.5 py-1 ring-1 ring-blue-100">{label}</span>)}
        </div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <div><dt className="font-semibold text-slate-900">Platforms</dt><dd className="mt-1 text-slate-600">{preview.summary.platforms.map(({ id, count }) => `${id} (${count})`).join(", ") || "None"}</dd></div>
          <div><dt className="font-semibold text-slate-900">Devices</dt><dd className="mt-1 text-slate-600">{preview.summary.devices.map(({ id, count }) => `${id} (${count})`).join(", ") || "None"}</dd></div>
          <div><dt className="font-semibold text-slate-900">Locales</dt><dd className="mt-1 text-slate-600">{preview.summary.locales.map(({ id, count }) => `${id} (${count})`).join(", ") || "None"}</dd></div>
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="planned-screens" className="min-w-0 rounded-2xl border border-[var(--editor-color-border)] p-4">
          <h3 id="planned-screens" className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">Planned screens and IDs</h3>
          {screens.length === 0 ? <p className="mt-3 text-sm text-slate-600">No valid capture screens were discovered.</p> : (
            <ul className="mt-3 space-y-3">
              {screens.map((screen) => (
                <li key={`${screen.sourcePath}:${screen.screenId}`} className="min-w-0 rounded-xl bg-slate-50 p-3 text-xs">
                  <p className="break-all font-semibold text-slate-900">{screen.screenId}</p>
                  <p className="mt-1 break-all text-slate-600">{screen.sourcePath}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{screen.resourcePath}</p>
                </li>
              ))}
            </ul>
          )}
          <MoreItems total={preview.screens.length} shown={screens.length} />
        </section>

        <section aria-labelledby="planned-resources" className="min-w-0 rounded-2xl border border-[var(--editor-color-border)] p-4">
          <h3 id="planned-resources" className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">Planned resource paths</h3>
          {resources.length === 0 ? <p className="mt-3 text-sm text-slate-600">No related resources are planned.</p> : (
            <ul className="mt-3 space-y-2">
              {resources.map((resource) => (
                <li key={`${resource.sourcePath}:${resource.destinationPath}`} className="rounded-xl bg-slate-50 p-3 text-xs">
                  <p className="break-all text-slate-600">{resource.sourcePath}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-slate-900">→ {resource.destinationPath}</p>
                </li>
              ))}
            </ul>
          )}
          <MoreItems total={preview.resources.length} shown={resources.length} />
        </section>
      </div>

      {warnings.length > 0 ? (
        <section aria-labelledby="capture-warnings" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
          <h3 id="capture-warnings" className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle aria-hidden="true" className="size-4" /> Warnings</h3>
          <ul className="mt-3 space-y-2 text-xs">{warnings.map((warning) => <li key={`${warning.code}:${warning.path}`}><span className="break-all font-semibold">{warning.path}</span><span className="block mt-0.5">{warning.message}</span></li>)}</ul>
          <MoreItems total={preview.warnings.length} shown={warnings.length} />
        </section>
      ) : null}

      {invalidEntries.length > 0 ? (
        <section aria-labelledby="capture-invalid" className={editorUi.statusError}>
          <h3 id="capture-invalid" className="font-semibold">Invalid entries block apply</h3>
          <ul className="mt-3 space-y-2 text-xs">{invalidEntries.map((entry) => <li key={`${entry.code}:${entry.path}`}><span className="break-all font-semibold">{entry.path}</span><span className="block mt-0.5">{entry.message}</span></li>)}</ul>
          <MoreItems total={preview.invalidEntries.length} shown={invalidEntries.length} />
        </section>
      ) : null}
    </div>
  );
}

export function CaptureImportDialog({
  state,
  onClose,
  onSelectFiles,
  onChooseDestination,
  onChooseCurrentLayout,
  onChangeNewProject,
  onPreview,
  onApply,
  onCancel,
  onRetry,
  onRecoverStale,
}: CaptureImportDialogProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const requiresRecovery = state.status === "error" && state.staleTarget;
  const recovering = state.status === "error" && state.recovering === true;
  const busy = state.status === "previewing" || state.status === "applying" || recovering;
  const chooseFolder = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length > 0) onSelectFiles(files);
  };

  return (
    <DialogShell
      title={state.status === "reviewing" || state.status === "applying"
        ? "Review capture import"
        : "Capture import"}
      description="Discover local PNG captures and related assets, choose an explicit receiver, preview every planned change, then confirm. This does not import a complete project."
      onClose={onClose}
      closeLabel="Close capture import"
      closeDisabled={busy || requiresRecovery}
      initialFocus="heading"
      widthClass="max-w-5xl"
      bodyClassName="p-4 sm:p-6"
    >
      {state.status === "editing" ? (
        <div className="space-y-6">
          <section aria-labelledby="capture-source" className="rounded-2xl border border-[var(--editor-color-border)] p-4 sm:p-5">
            <h3 id="capture-source" className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">1. Choose capture folder</h3>
            <p className="mt-2 text-xs leading-5 text-[color:var(--editor-color-text-secondary)]">
              Supported structure: <code>screenshots/&lt;platform&gt;/&lt;device&gt;/&lt;locale&gt;/&lt;file&gt;.png</code> (or without the screenshots prefix), plus supported related files under <code>assets/</code>.
            </p>
            <button type="button" className={`mt-4 ${editorUi.buttonSecondary}`} onClick={() => folderInputRef.current?.click()}>
              <FolderOpen aria-hidden="true" className="size-4" /> Choose capture folder
            </button>
            <input
              ref={(node) => {
                folderInputRef.current = node;
                node?.setAttribute("webkitdirectory", "");
              }}
              type="file"
              multiple
              tabIndex={-1}
              aria-label="Choose capture folder"
              className="sr-only"
              onChange={chooseFolder}
            />
            <p className="mt-3 text-xs text-[color:var(--editor-color-text-muted)]">
              {state.draft.files.length > 0
                ? plural(state.draft.files.length, "file") + " selected"
                : "No folder selected yet."}
            </p>
          </section>

          <fieldset className="rounded-2xl border border-[var(--editor-color-border)] p-4 sm:p-5">
            <legend className="px-1 text-sm font-semibold text-[color:var(--editor-color-text-strong)]">2. Choose where captures are added</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {state.draft.currentTarget ? (
                <label className={editorUi.choiceCard}>
                  <input type="radio" name="capture-destination" checked={state.draft.destinationKind === "current-project"} onChange={() => onChooseDestination("current-project")} />
                  <span className="ml-2 font-semibold text-[color:var(--editor-color-text-strong)]">Current project and layout</span>
                  <span className="mt-2 block pl-6 text-xs leading-5 text-[color:var(--editor-color-text-muted)]">Add screens only to the explicitly selected active project layout.</span>
                </label>
              ) : null}
              <label className={editorUi.choiceCard}>
                <input type="radio" name="capture-destination" checked={state.draft.destinationKind === "new-project"} onChange={() => onChooseDestination("new-project")} />
                <span className="ml-2 font-semibold text-[color:var(--editor-color-text-strong)]">New managed project</span>
                <span className="mt-2 block pl-6 text-xs leading-5 text-[color:var(--editor-color-text-muted)]">Create and activate a separate managed receiver through the existing project creation seam.</span>
              </label>
            </div>

            {state.draft.destinationKind === "current-project" && state.draft.currentTarget ? (
              <div className="mt-4 grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
                <div><p className="text-xs font-semibold text-slate-500">Receiving project</p><p className="mt-1 text-sm font-semibold text-slate-950">{state.draft.currentTarget.projectName}</p></div>
                <div className="text-xs font-semibold text-slate-700">
                  <span>Receiving layout</span>
                  <MenuSelect
                    ariaLabel="Receiving layout"
                    menuLabel="Receiving layout options"
                    className="mt-2"
                    value={state.draft.currentLayoutId}
                    options={state.draft.currentTarget.layouts.map(({ id, name }) => ({ value: id, label: name }))}
                    onChange={onChooseCurrentLayout}
                  />
                </div>
              </div>
            ) : null}

            {state.draft.destinationKind === "new-project" ? (
              <div className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4">
                <label className="block text-xs font-semibold text-slate-700">Project name<input className={`mt-2 ${editorUi.field}`} type="text" required autoComplete="off" value={state.draft.newProject.name} onChange={(event) => onChangeNewProject({ name: event.currentTarget.value })} /></label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="text-xs font-semibold text-slate-700"><span>Target platform</span><MenuSelect ariaLabel="Target platform" menuLabel="Target platform options" className="mt-2" value={state.draft.newProject.platform} options={PLATFORM_OPTIONS} onChange={(platform) => onChangeNewProject({ platform })} /></div>
                  <div className="text-xs font-semibold text-slate-700"><span>Layout mode</span><MenuSelect ariaLabel="Layout mode" menuLabel="Layout mode options" className="mt-2" value={state.draft.newProject.layoutMode} options={LAYOUT_MODE_OPTIONS} onChange={(layoutMode) => onChangeNewProject({ layoutMode })} /></div>
                </div>
                <p className="text-xs leading-5 text-slate-600"><strong className="text-slate-900">Capture-ready empty project.</strong> The selected platform and layout mode define the validated scaffold; discovered captures replace its starter screen.</p>
              </div>
            ) : null}
          </fieldset>

          {state.notice ? <p role="status" className={editorUi.statusProgress}>{state.notice}. No project data was changed.</p> : null}
          <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--editor-color-border)] pt-5">
            <button type="button" className={editorUi.buttonSecondary} onClick={onClose}>Cancel</button>
            <button type="button" className={editorUi.buttonPrimary} disabled={!canPreviewCaptureImport(state)} onClick={onPreview}><FileImage aria-hidden="true" className="size-4" /> Preview capture import</button>
          </div>
        </div>
      ) : null}

      {state.status === "previewing" ? (
        <div className="rounded-2xl border border-[var(--editor-color-border)] bg-slate-50 p-5" role="status" aria-live="polite">
          <div className="flex gap-3"><LoaderCircle aria-hidden="true" className="mt-0.5 size-5 animate-spin text-blue-600 motion-reduce:animate-none" /><div><p className="font-semibold text-slate-950">Discovering captures and planning the receiver…</p><p className="mt-1 text-sm text-slate-600">Preview is read-only and safe to repeat.</p></div></div>
          <button type="button" className={`mt-4 ${editorUi.buttonSecondary}`} onClick={onCancel}>Cancel capture import</button>
        </div>
      ) : null}

      {state.status === "reviewing" ? (
        <div className="space-y-6">
          <CapturePreview state={state} />
          <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--editor-color-border)] pt-5">
            <button type="button" className={editorUi.buttonSecondary} onClick={onRetry}>Edit selection or destination</button>
            <button type="button" className={editorUi.buttonPrimary} disabled={!canApplyCaptureImport(state)} onClick={onApply}>Confirm capture import</button>
          </div>
        </div>
      ) : null}

      {state.status === "applying" ? (
        <div className="space-y-5">
          <CapturePreview state={state} />
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5" role="status" aria-live="polite">
            <div className="flex gap-3"><LoaderCircle aria-hidden="true" className="mt-0.5 size-5 animate-spin text-blue-600 motion-reduce:animate-none" /><div><p className="font-semibold text-slate-950">Applying capture import…</p><p className="mt-1 text-sm text-slate-600">The Project and managed resources will commit together or roll back completely.</p></div></div>
            <button type="button" className={`mt-4 ${editorUi.buttonSecondary}`} onClick={onCancel}>Cancel capture import</button>
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="space-y-5">
          <div role="alert" className={editorUi.statusError}><p className="font-semibold">Capture import could not be completed</p><p className="mt-1">{state.message}</p>{state.staleTarget ? <p className="mt-2">The active project or revision changed. Reload it before previewing again.</p> : null}</div>
          <div className="flex flex-wrap justify-end gap-3">
            {state.staleTarget ? null : <button type="button" className={editorUi.buttonSecondary} onClick={onClose}>Close</button>}
            {state.staleTarget ? <button type="button" className={editorUi.buttonPrimary} disabled={recovering} onClick={onRecoverStale}>{recovering ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : null}{recovering ? "Reloading active project…" : "Reload active project"}</button> : <button type="button" className={editorUi.buttonPrimary} onClick={onRetry}>Preview again</button>}
          </div>
        </div>
      ) : null}
    </DialogShell>
  );
}
