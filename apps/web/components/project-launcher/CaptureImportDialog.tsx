// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useRef, type ChangeEvent } from "react";
import {
  AlertTriangle,
  FileImage,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import { type CanvasMode, type Platform } from "@screenshot-studio/core/model";
import {
  DEFAULT_STORE_SPECS,
  listOutputDestinations,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { DialogShell } from "@web/components/editor-ui/DialogShell";
import { MenuSelect, type MenuSelectOption } from "@web/components/editor-ui/MenuSelect";
import { editorUi } from "@web/components/editor-ui/styles";
import { LAYOUT_MODE_LABELS } from "@web/lib/layout-mode-labels";
import {
  canApplyCaptureImport,
  canPreviewCaptureImport,
  type CaptureImportNewProjectPatch,
  type CaptureImportState,
} from "./capture-import-model";

const PREVIEW_ITEM_LIMIT = 50;

export const captureImportPlatformOptions: readonly MenuSelectOption<Platform>[] =
  listOutputDestinations(DEFAULT_STORE_SPECS).map(({ id, label }) => ({ value: id, label }));

const LAYOUT_MODE_OPTIONS: readonly MenuSelectOption<CanvasMode>[] = [
  { value: "isolated", label: LAYOUT_MODE_LABELS.isolated },
  { value: "connected", label: LAYOUT_MODE_LABELS.connected },
];

type OpenCaptureImportState = Exclude<CaptureImportState, { status: "closed" }>;

export interface CaptureImportDialogProps {
  state: OpenCaptureImportState;
  specs?: StoreSpecs;
  onClose(): void;
  onSelectFiles(files: readonly File[]): void;
  onChooseDestination(kind: "current-project" | "new-project"): void;
  onChooseCurrentLayout(layoutId: string): void;
  onChangeNewProject(patch: CaptureImportNewProjectPatch): void;
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
      <section aria-labelledby="capture-receiver" className="rounded-2xl border border-[var(--editor-color-accent-border)] bg-[var(--editor-color-accent-subtle)] p-4 sm:p-5">
        <p className={editorUi.sectionLabel}>Planned receiver</p>
        <h3 id="capture-receiver" className="mt-2 font-semibold text-[color:var(--editor-color-text-strong)]">
          {preview.receiving.projectName}
        </h3>
        <p className="mt-1 text-sm text-[color:var(--editor-color-text-secondary)]">
          {preview.receiving.kind === "new-project" ? "New managed project" : "Current project"}
          {" · Layout: "}{preview.receiving.layoutName}
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-[color:var(--editor-color-text-default)]">
          {[plural(preview.summary.screenCount, "screen"), plural(preview.summary.assetCount, "related asset")]
            .map((label) => <span key={label} className="rounded-full bg-[var(--editor-color-surface)] px-2.5 py-1 ring-1 ring-[var(--editor-color-accent-muted)]">{label}</span>)}
        </div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
          <div><dt className="font-semibold text-[color:var(--editor-color-text-strong)]">Platforms</dt><dd className="mt-1 text-[color:var(--editor-color-text-muted)]">{preview.summary.platforms.map(({ id, count }) => `${id} (${count})`).join(", ") || "None"}</dd></div>
          <div><dt className="font-semibold text-[color:var(--editor-color-text-strong)]">Devices</dt><dd className="mt-1 text-[color:var(--editor-color-text-muted)]">{preview.summary.devices.map(({ id, count }) => `${id} (${count})`).join(", ") || "None"}</dd></div>
          <div><dt className="font-semibold text-[color:var(--editor-color-text-strong)]">Locales</dt><dd className="mt-1 text-[color:var(--editor-color-text-muted)]">{preview.summary.locales.map(({ id, count }) => `${id} (${count})`).join(", ") || "None"}</dd></div>
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="planned-screens" className="min-w-0 rounded-2xl border border-[var(--editor-color-border)] p-4">
          <h3 id="planned-screens" className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">Planned screens and IDs</h3>
          {screens.length === 0 ? <p className="mt-3 text-sm text-[color:var(--editor-color-text-muted)]">No valid capture screens were discovered.</p> : (
            <ul className="mt-3 space-y-3">
              {screens.map((screen) => (
                <li key={`${screen.sourcePath}:${screen.screenId}`} className="min-w-0 rounded-xl bg-[var(--editor-color-surface-subtle)] p-3 text-xs">
                  <p className="break-all font-semibold text-[color:var(--editor-color-text-strong)]">{screen.screenId}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-[color:var(--editor-color-text-secondary)]">Element: {screen.elementId}</p>
                  <p className="mt-1 break-all text-[color:var(--editor-color-text-muted)]">{screen.sourcePath}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-[color:var(--editor-color-text-secondary)]">{screen.resourcePath}</p>
                </li>
              ))}
            </ul>
          )}
          <MoreItems total={preview.screens.length} shown={screens.length} />
        </section>

        <section aria-labelledby="planned-resources" className="min-w-0 rounded-2xl border border-[var(--editor-color-border)] p-4">
          <h3 id="planned-resources" className="text-sm font-semibold text-[color:var(--editor-color-text-strong)]">Planned resource paths</h3>
          {resources.length === 0 ? <p className="mt-3 text-sm text-[color:var(--editor-color-text-muted)]">No related resources are planned.</p> : (
            <ul className="mt-3 space-y-2">
              {resources.map((resource) => (
                <li key={`${resource.sourcePath}:${resource.destinationPath}`} className="rounded-xl bg-[var(--editor-color-surface-subtle)] p-3 text-xs">
                  <p className="break-all text-[color:var(--editor-color-text-muted)]">{resource.sourcePath}</p>
                  <p className="mt-1 break-all font-mono text-[10px] text-[color:var(--editor-color-text-strong)]">→ {resource.destinationPath}</p>
                </li>
              ))}
            </ul>
          )}
          <MoreItems total={preview.resources.length} shown={resources.length} />
        </section>
      </div>

      {warnings.length > 0 ? (
        <section aria-labelledby="capture-warnings" className="rounded-2xl border border-[var(--editor-color-warning-border)] bg-[var(--editor-color-warning-surface)] p-4 text-[color:var(--editor-color-warning-text-strong)]">
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
  specs = DEFAULT_STORE_SPECS,
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
  const platformOptions = listOutputDestinations(specs)
    .map(({ id, label }) => ({ value: id, label }));
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
              <div className="mt-4 grid gap-4 rounded-xl bg-[var(--editor-color-surface-subtle)] p-4 sm:grid-cols-2">
                <div><p className="text-xs font-semibold text-[color:var(--editor-color-text-secondary)]">Receiving project</p><p className="mt-1 text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{state.draft.currentTarget.projectName}</p></div>
                <div className="text-xs font-semibold text-[color:var(--editor-color-text-default)]">
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
              <div className="mt-4 space-y-4 rounded-xl bg-[var(--editor-color-surface-subtle)] p-4">
                <label className="block text-xs font-semibold text-[color:var(--editor-color-text-default)]">Project name<input className={`mt-2 ${editorUi.field}`} type="text" required autoComplete="off" value={state.draft.newProject.name} onChange={(event) => onChangeNewProject({ name: event.currentTarget.value })} /></label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="text-xs font-semibold text-[color:var(--editor-color-text-default)]"><span>Target platform</span><MenuSelect ariaLabel="Target platform" menuLabel="Target platform options" className="mt-2" value={state.draft.newProject.platform} options={platformOptions} onChange={(platform) => onChangeNewProject({ platform })} /></div>
                  <div className="text-xs font-semibold text-[color:var(--editor-color-text-default)]"><span>Layout mode</span><MenuSelect ariaLabel="Layout mode" menuLabel="Layout mode options" className="mt-2" value={state.draft.newProject.layoutMode} options={LAYOUT_MODE_OPTIONS} onChange={(layoutMode) => onChangeNewProject({ layoutMode })} /></div>
                </div>
                <p className="text-xs leading-5 text-[color:var(--editor-color-text-muted)]"><strong className="text-[color:var(--editor-color-text-strong)]">Capture-ready empty project.</strong> The selected platform and layout mode define the validated scaffold; discovered captures replace its starter screen.</p>
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
        <div className="rounded-2xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] p-5" role="status" aria-live="polite">
          <div className="flex gap-3"><LoaderCircle aria-hidden="true" className="mt-0.5 size-5 animate-spin text-[color:var(--editor-color-accent-text)] motion-reduce:animate-none" /><div><p className="font-semibold text-[color:var(--editor-color-text-strong)]">Discovering captures and planning the receiver…</p><p className="mt-1 text-sm text-[color:var(--editor-color-text-muted)]">Preview is read-only and safe to repeat.</p></div></div>
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
          <div className="rounded-2xl border border-[var(--editor-color-accent-border)] bg-[var(--editor-color-accent-subtle)] p-5" role="status" aria-live="polite">
            <div className="flex gap-3"><LoaderCircle aria-hidden="true" className="mt-0.5 size-5 animate-spin text-[color:var(--editor-color-accent-text)] motion-reduce:animate-none" /><div><p className="font-semibold text-[color:var(--editor-color-text-strong)]">Applying capture import…</p><p className="mt-1 text-sm text-[color:var(--editor-color-text-muted)]">The Project and managed resources will commit together or roll back completely.</p></div></div>
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
