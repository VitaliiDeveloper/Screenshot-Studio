// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState, type FormEvent } from "react";
import { useStore } from "zustand";
import { ArrowLeftRight, Languages, Trash2 } from "lucide-react";
import type { LayoutDirection } from "@screenshot-studio/core/model";
import { editorStore } from "../lib/editor-store";
import { mutateAndSave } from "../lib/mutate-and-save";
import { DialogShell, cx, editorUi } from "./editor-ui";

function localeDirection(
  project: NonNullable<ReturnType<typeof editorStore.getState>["project"]>,
  locale: string,
): LayoutDirection {
  return project.screens.find((screen) => screen.locale === locale)?.direction ?? "ltr";
}

export function LocaleManagerDialog({ onClose }: { onClose: () => void }) {
  const project = useStore(editorStore, (state) => state.project);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const activeLocale = project?.screens.find((screen) => screen.id === activeScreenId)?.locale
    ?? project?.locales[0]
    ?? "";
  const [sourceLocale, setSourceLocale] = useState(activeLocale);
  const [targetLocale, setTargetLocale] = useState("");
  const [targetDirection, setTargetDirection] = useState<LayoutDirection>(
    project ? localeDirection(project, activeLocale) : "ltr",
  );
  const [error, setError] = useState<string | null>(null);

  if (!project) return null;

  const mutate = (action: () => void): boolean => {
    try {
      setError(null);
      mutateAndSave(action);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  const createLocale = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!targetLocale.trim()) {
      setError("Target locale must not be empty");
      return;
    }
    if (project.locales.includes(targetLocale)) {
      setError(`Locale "${targetLocale}" already exists`);
      return;
    }
    if (mutate(() => editorStore.getState().addLocale(sourceLocale, targetLocale, targetDirection))) {
      onClose();
    }
  };

  const changeDirection = (locale: string, current: LayoutDirection) => {
    const next: LayoutDirection = current === "ltr" ? "rtl" : "ltr";
    if (!window.confirm(
      `Mirror locale "${locale}" to ${next.toUpperCase()}? Horizontal placement and text alignment will change.`,
    )) return;
    if (mutate(() => editorStore.getState().setLocaleDirection(locale, next)) && sourceLocale === locale) {
      setTargetDirection(next);
    }
  };

  const remove = (locale: string) => {
    if (!window.confirm(`Delete locale "${locale}" and all ${project.screens.filter((screen) => screen.locale === locale).length} screens?`)) return;
    const remainingLocale = project.locales.find((candidate) => candidate !== locale);
    if (mutate(() => editorStore.getState().removeLocale(locale)) && sourceLocale === locale && remainingLocale) {
      setSourceLocale(remainingLocale);
      setTargetDirection(localeDirection(editorStore.getState().project!, remainingLocale));
    }
  };

  return (
    <DialogShell
      title="Locales"
      description="Clone complete screenshot sets and bake an explicit LTR or RTL layout direction."
      ariaLabel="Locale manager"
      closeLabel="Close locale manager"
      widthClass="max-w-2xl"
      onClose={onClose}
    >
      <div className="space-y-5">
        <form className="rounded-xl border border-slate-200 bg-slate-50 p-3" onSubmit={createLocale}>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-800">
            <Languages size={15} strokeWidth={1.9} /> Create locale from an existing set
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
            <label className="space-y-1">
              <span className="block text-[11px] font-medium text-slate-600">Target locale</span>
              <input
                aria-label="Target locale"
                className={editorUi.field}
                value={targetLocale}
                placeholder="ar"
                onChange={(event) => setTargetLocale(event.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] font-medium text-slate-600">Copy from</span>
              <select
                aria-label="Copy from locale"
                className={editorUi.field}
                value={sourceLocale}
                onChange={(event) => {
                  const locale = event.target.value;
                  setSourceLocale(locale);
                  setTargetDirection(localeDirection(project, locale));
                }}
              >
                {project.locales.map((locale) => <option key={locale} value={locale}>{locale}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] font-medium text-slate-600">Direction</span>
              <select
                aria-label="Layout direction"
                className={editorUi.field}
                value={targetDirection}
                onChange={(event) => setTargetDirection(event.target.value as LayoutDirection)}
              >
                <option value="ltr">LTR</option>
                <option value="rtl">RTL</option>
              </select>
            </label>
            <button type="submit" className={cx(editorUi.buttonPrimary, "h-8")}>Create locale</button>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-slate-500">
            Choosing a different direction mirrors placement once; screenshots and device content are never reflected.
          </p>
        </form>

        {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}

        <section aria-label="Project locales">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Current locales</h3>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {project.locales.map((locale) => {
              const screens = project.screens.filter((screen) => screen.locale === locale);
              const direction = screens[0]!.direction;
              const active = locale === activeLocale;
              return (
                <div key={locale} data-locale={locale} className="flex flex-wrap items-center gap-2 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{locale}</span>
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">{direction}</span>
                      {active ? <span className="text-[10px] font-medium text-blue-600">Active</span> : null}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">{screens.length} {screens.length === 1 ? "screen" : "screens"}</p>
                  </div>
                  <button
                    type="button"
                    className={editorUi.buttonGhost}
                    aria-label={`Switch to ${locale}`}
                    disabled={active}
                    onClick={() => {
                      editorStore.getState().selectLocale(locale);
                      onClose();
                    }}
                  >
                    Switch
                  </button>
                  <button
                    type="button"
                    className={editorUi.buttonSecondary}
                    aria-label={`Mirror ${locale} to ${direction === "ltr" ? "RTL" : "LTR"}`}
                    onClick={() => changeDirection(locale, direction)}
                  >
                    <ArrowLeftRight size={14} strokeWidth={1.9} /> {direction === "ltr" ? "Make RTL" : "Make LTR"}
                  </button>
                  <button
                    type="button"
                    className={editorUi.buttonDanger}
                    aria-label={`Delete locale ${locale}`}
                    disabled={project.locales.length === 1}
                    onClick={() => remove(locale)}
                  >
                    <Trash2 size={14} strokeWidth={1.9} /> Delete
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </DialogShell>
  );
}
