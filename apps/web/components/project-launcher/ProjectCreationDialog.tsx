// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { type FormEvent } from "react";
import { Layers3, LoaderCircle, Plus } from "lucide-react";
import {
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_TEMPLATE_GRADIENT_ANGLE_DEGREES,
  type ProjectTemplateSummary,
} from "@screenshot-studio/core/scaffold";
import { DialogShell } from "@web/components/editor-ui/DialogShell";
import { MenuSelect, type MenuSelectOption } from "@web/components/editor-ui/MenuSelect";
import { cx, editorUi } from "@web/components/editor-ui/styles";
import {
  isProjectTemplateSupported,
  type ProjectCreationForm,
  type ProjectCreationState,
} from "./project-creation-model";

type OpenProjectCreationState = Exclude<ProjectCreationState, { status: "closed" }>;

export interface ProjectCreationDialogProps {
  state: OpenProjectCreationState;
  templates: readonly ProjectTemplateSummary[];
  onClose(): void;
  onChange(patch: Partial<ProjectCreationForm>): void;
  onSubmit(): void;
}

const PLATFORM_OPTIONS: readonly MenuSelectOption<ProjectCreationForm["platform"]>[] = [
  { value: "apple", label: "Apple App Store" },
  { value: "android", label: "Google Play" },
  { value: "windows", label: "Microsoft Store" },
  { value: "web", label: "Web" },
];

function platformList(template: ProjectTemplateSummary): string {
  return template.supportedPlatforms.map((platform) => (
    platform === "apple" ? "Apple" : platform === "android" ? "Android" : platform === "windows" ? "Windows" : "Web"
  )).join(", ");
}

export function ProjectCreationDialog({
  state,
  templates,
  onClose,
  onChange,
  onSubmit,
}: ProjectCreationDialogProps) {
  const busy = state.status === "creating" || state.status === "completing";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) onSubmit();
  };
  const changePlatform = (platform: ProjectCreationForm["platform"]) => {
    const selected = templates.find(({ id }) => id === state.form.templateId);
    onChange({
      platform,
      ...(selected && !isProjectTemplateSupported(selected, platform) ? { templateId: null } : {}),
    });
  };
  const visibleTemplates = templates.filter((template) => (
    isProjectTemplateSupported(template, state.form.platform)
  ));

  return (
    <DialogShell
      title="Create a managed project"
      description="Choose the first store target and layout mode. Screenshot Studio validates the complete starter before publishing it to managed storage."
      onClose={onClose}
      closeLabel="Close project creation"
      closeDisabled={busy}
      initialFocus="heading"
      widthClass="max-w-4xl"
      bodyClassName="p-5 [overflow-anchor:none] sm:p-7"
      motion={state.status === "completing" ? "closing" : "open"}
    >
        <form className="space-y-6" onSubmit={submit}>
          <fieldset disabled={busy} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-[color:var(--editor-color-text-default)]">
                Project name
                <input
                  type="text"
                  required
                  maxLength={PROJECT_NAME_MAX_LENGTH}
                  autoComplete="off"
                  className={`mt-2 ${editorUi.field}`}
                  value={state.form.name}
                  onChange={(event) => onChange({ name: event.currentTarget.value })}
                />
              </label>
              <div className="text-sm font-semibold text-[color:var(--editor-color-text-default)]">
                <span>Target platform</span>
                <MenuSelect
                  ariaLabel="Target platform"
                  menuLabel="Target platform options"
                  className="mt-2"
                  value={state.form.platform}
                  options={PLATFORM_OPTIONS}
                  onChange={changePlatform}
                />
              </div>
            </div>

            <fieldset>
              <legend className="text-sm font-semibold text-[color:var(--editor-color-text-default)]">Layout mode</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {([
                  ["isolated", "Isolated", "Design each store image independently."],
                  ["connected", "Connected", "Compose screens as one continuous strip."],
                ] as const).map(([value, label, description]) => (
                  <label key={value} className={editorUi.choiceCard}>
                    <input type="radio" name="layout-mode" value={value} checked={state.form.layoutMode === value} onChange={() => onChange({ layoutMode: value })} />
                    <span className="ml-2 font-semibold text-[color:var(--editor-color-text-strong)]">{label}</span>
                    <span className="mt-1 block pl-6 text-xs leading-5 text-[color:var(--editor-color-text-muted)]">{description}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-semibold text-[color:var(--editor-color-text-default)]">Starting point</legend>
              <p className="mt-1 text-xs leading-5 text-[color:var(--editor-color-text-secondary)]">Choose a complete starter here, then add more built-in or project-local screen templates from Resources.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className={editorUi.choiceCard}>
                  <input type="radio" name="starter" checked={state.form.templateId === null} onChange={() => onChange({ templateId: null })} />
                  <span className="mt-4 grid size-10 place-items-center rounded-xl bg-[var(--editor-color-surface-muted)] text-[color:var(--editor-color-text-secondary)]"><Plus aria-hidden="true" className="size-5" /></span>
                  <span className="mt-4 block font-semibold text-[color:var(--editor-color-text-strong)]">Blank</span>
                  <span className="mt-1 block text-xs leading-5 text-[color:var(--editor-color-text-muted)]">One valid blank screen using the selected platform’s lead store size.</span>
                </label>
                {visibleTemplates.map((template) => {
                  return (
                    <label
                      key={template.id}
                      className={editorUi.choiceCard}
                    >
                      <input type="radio" name="starter" value={template.id} checked={state.form.templateId === template.id} onChange={() => onChange({ templateId: template.id })} />
                      <span
                        aria-hidden="true"
                        className="mt-3 block h-20 overflow-hidden rounded-xl p-3"
                        style={{ background: `linear-gradient(${PROJECT_TEMPLATE_GRADIENT_ANGLE_DEGREES}deg, ${template.preview.backgroundFrom}, ${template.preview.backgroundTo})` }}
                      >
                        <span className="block h-full w-2/3 rounded-lg opacity-90" style={{ backgroundColor: template.preview.accent }} />
                      </span>
                      <span className="mt-3 block font-semibold text-[color:var(--editor-color-text-strong)]">{template.name}</span>
                      <span className="mt-1 block text-xs leading-5 text-[color:var(--editor-color-text-muted)]">{template.description}</span>
                      <span className="mt-2 block text-[11px] font-semibold text-[color:var(--editor-color-text-muted)]">Best for: {template.intendedUse}</span>
                      <span className="mt-2 block text-[10px] uppercase tracking-wide text-[color:var(--editor-color-text-secondary)]">Supports {platformList(template)}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </fieldset>

          <div className="min-h-9">
            {state.status === "error" ? <p role="alert" className={editorUi.statusError}>{state.message} Check the configuration and try again.</p> : null}
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t border-[var(--editor-color-border)] pt-5">
            <button
              type="button"
              className={cx(editorUi.buttonSecondary, busy ? "invisible" : undefined)}
              disabled={busy}
              aria-hidden={busy || undefined}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={editorUi.buttonPrimary}
              disabled={!busy && !state.form.name.trim()}
              aria-disabled={busy || undefined}
              tabIndex={busy ? -1 : undefined}
            >
              {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <Layers3 aria-hidden="true" className="size-4" />}
              {busy ? "Creating project…" : state.status === "error" ? "Try creating again" : "Create project"}
            </button>
          </div>
        </form>
    </DialogShell>
  );
}
