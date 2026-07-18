// SPDX-License-Identifier: Apache-2.0
"use client";

import React, { useEffect, useId, useRef, type FormEvent } from "react";
import { Layers3, LoaderCircle, Plus, X } from "lucide-react";
import type { ProjectTemplateSummary } from "@screenshot-studio/core/scaffold";
import { editorUi } from "../editor-ui/styles";
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

const PLATFORM_LABELS = {
  apple: "Apple App Store",
  android: "Google Play",
  windows: "Microsoft Store",
} as const;

const PLATFORM_SHORT_LABELS = {
  apple: "Apple",
  android: "Android",
  windows: "Windows",
} as const;

const focusableSelector = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "a[href]",
].join(", ");

function platformList(template: ProjectTemplateSummary): string {
  return template.supportedPlatforms.map((platform) => (
    platform === "apple" ? "Apple" : platform === "android" ? "Android" : "Windows"
  )).join(", ");
}

export function ProjectCreationDialog({
  state,
  templates,
  onClose,
  onChange,
  onSubmit,
}: ProjectCreationDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state.status !== "creating") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      );
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
  }, [onClose, state.status]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (state.status !== "creating") onSubmit();
  };
  const changePlatform = (platform: ProjectCreationForm["platform"]) => {
    const selected = templates.find(({ id }) => id === state.form.templateId);
    onChange({
      platform,
      ...(selected && !isProjectTemplateSupported(selected, platform) ? { templateId: null } : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-3 backdrop-blur-[2px] sm:p-5">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/60 bg-white p-5 shadow-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={editorUi.sectionLabel}>Create project</p>
            <h2 ref={headingRef} tabIndex={-1} id={titleId} className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 outline-none">
              Create a managed project
            </h2>
          </div>
          {state.status !== "creating" ? (
            <button type="button" aria-label="Close project creation" className={editorUi.iconButton} onClick={onClose}>
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>
        <p id={descriptionId} className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Choose the first store target and layout mode. Screenshot Studio validates the complete starter before publishing it to managed storage.
        </p>

        <form className="mt-6 space-y-6" onSubmit={submit}>
          <fieldset disabled={state.status === "creating"} className="space-y-6 disabled:opacity-75">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-800">
                Project name
                <input
                  type="text"
                  required
                  maxLength={120}
                  autoComplete="off"
                  className={`mt-2 ${editorUi.field}`}
                  value={state.form.name}
                  onChange={(event) => onChange({ name: event.currentTarget.value })}
                />
              </label>
              <label className="text-sm font-semibold text-slate-800">
                Target platform
                <select
                  className={`mt-2 ${editorUi.field}`}
                  value={state.form.platform}
                  onChange={(event) => changePlatform(event.currentTarget.value as ProjectCreationForm["platform"])}
                >
                  {Object.entries(PLATFORM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>

            <fieldset>
              <legend className="text-sm font-semibold text-slate-800">Layout mode</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {([
                  ["isolated", "Isolated", "Design each store image independently."],
                  ["connected", "Connected", "Compose screens as one continuous strip."],
                ] as const).map(([value, label, description]) => (
                  <label key={value} className="cursor-pointer rounded-2xl border border-slate-200 p-4 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                    <input type="radio" name="layout-mode" value={value} checked={state.form.layoutMode === value} onChange={() => onChange({ layoutMode: value })} />
                    <span className="ml-2 font-semibold text-slate-900">{label}</span>
                    <span className="mt-1 block pl-6 text-xs leading-5 text-slate-600">{description}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-semibold text-slate-800">Starting point</legend>
              <p className="mt-1 text-xs leading-5 text-slate-500">Project templates are complete creation-only starters. Screen templates and component presets remain Workspace tools.</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="cursor-pointer rounded-2xl border border-slate-200 p-4 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                  <input type="radio" name="starter" checked={state.form.templateId === null} onChange={() => onChange({ templateId: null })} />
                  <span className="mt-4 grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-600"><Plus aria-hidden="true" className="size-5" /></span>
                  <span className="mt-4 block font-semibold text-slate-950">Empty project</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">One valid blank screen using the selected platform’s lead store size.</span>
                </label>
                {templates.map((template) => {
                  const supported = isProjectTemplateSupported(template, state.form.platform);
                  return (
                    <label key={template.id} className={`rounded-2xl border p-4 ${supported ? "cursor-pointer border-slate-200 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50" : "cursor-not-allowed border-slate-200 bg-slate-50 opacity-65"}`}>
                      <input type="radio" name="starter" value={template.id} disabled={!supported} checked={state.form.templateId === template.id} onChange={() => onChange({ templateId: template.id })} />
                      <span
                        aria-hidden="true"
                        className="mt-3 block h-20 overflow-hidden rounded-xl p-3"
                        style={{ background: `linear-gradient(135deg, ${template.preview.backgroundFrom}, ${template.preview.backgroundTo})` }}
                      >
                        <span className="block h-full w-2/3 rounded-lg opacity-90" style={{ backgroundColor: template.preview.accent }} />
                      </span>
                      <span className="mt-3 block font-semibold text-slate-950">{template.name}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-600">{template.description}</span>
                      <span className="mt-2 block text-[11px] font-semibold text-slate-700">Best for: {template.intendedUse}</span>
                      <span className="mt-2 block text-[10px] uppercase tracking-wide text-slate-500">Supports {platformList(template)}</span>
                      {!supported ? <span className="mt-2 block text-xs font-semibold text-amber-700">Not available for {PLATFORM_SHORT_LABELS[state.form.platform]}</span> : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </fieldset>

          {state.status === "error" ? <p role="alert" className={editorUi.statusError}>{state.message} Check the configuration and try again.</p> : null}
          {state.status === "creating" ? <p role="status" className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900">Validating and publishing the managed project…</p> : null}

          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-5">
            {state.status !== "creating" ? <button type="button" className={editorUi.buttonSecondary} onClick={onClose}>Cancel</button> : null}
            <button type="submit" className={editorUi.buttonPrimary} disabled={state.status === "creating" || !state.form.name.trim()}>
              {state.status === "creating" ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <Layers3 aria-hidden="true" className="size-4" />}
              {state.status === "creating" ? "Creating project…" : state.status === "error" ? "Try creating again" : "Create project"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
