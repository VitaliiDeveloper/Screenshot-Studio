// SPDX-License-Identifier: Apache-2.0
"use client";

import { useState, type FormEvent } from "react";
import { useStore } from "zustand";
import { ArrowLeft, ArrowLeftRight, Languages, Table2, Trash2 } from "lucide-react";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { layoutLocales, type DesignLayout, type LayoutDirection, type Screen } from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { editorStore, selectEditorLayout } from "@web/lib/editor/editor-store";
import { mutateAndSave } from "@web/lib/editor/mutate-and-save";
import { ConfirmationDialog, DialogShell, MenuSelect, SegmentedControl, cx, editorUi } from "./editor-ui";
import { LocaleMatrixTable } from "./LocaleMatrixTable";
import { localeMatrix, localeMatrixSummary } from "./locale-matrix-model";

type PendingLocaleAction =
  | { kind: "direction"; locale: string; next: LayoutDirection }
  | { kind: "delete"; locale: string; screenCount: number };

function localeDirection(
  layout: DesignLayout,
  locale: string,
): LayoutDirection {
  return layout.screens.find((screen) => screen.locale === locale)?.direction ?? "ltr";
}

export function LocaleManagerDialog({
  issues,
  specs,
  onClose,
}: {
  /** The editor's live Issues; each matrix cell matches their missing-locale entries. */
  issues: readonly ProjectIssue[];
  specs: StoreSpecs;
  onClose: () => void;
}) {
  const project = useStore(editorStore, (state) => state.project);
  const layout = useStore(editorStore, selectEditorLayout);
  const activeScreenId = useStore(editorStore, (state) => state.activeScreenId);
  const activeLocale = layout?.screens.find((screen) => screen.id === activeScreenId)?.locale
    ?? layout?.screens[0]?.locale
    ?? "";
  const [sourceLocale, setSourceLocale] = useState(activeLocale);
  const [targetLocale, setTargetLocale] = useState("");
  const [targetDirection, setTargetDirection] = useState<LayoutDirection>(
    layout ? localeDirection(layout, activeLocale) : "ltr",
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingLocaleAction | null>(null);
  // The matrix keeps the size it was opened on, even when "+ EN" moves the active screen.
  const [matrixScreen, setMatrixScreen] = useState<Screen | null>(null);

  if (!project || !layout) return null;
  const locales = layoutLocales(layout);

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
    if (locales.includes(targetLocale)) {
      setError(`Locale "${targetLocale}" already exists`);
      return;
    }
    if (mutate(() => editorStore.getState().addLocale(sourceLocale, targetLocale, targetDirection))) {
      onClose();
    }
  };

  const changeDirection = (locale: string, current: LayoutDirection) => {
    const next: LayoutDirection = current === "ltr" ? "rtl" : "ltr";
    setPendingAction({ kind: "direction", locale, next });
  };

  const remove = (locale: string) => {
    setPendingAction({
      kind: "delete",
      locale,
      screenCount: layout.screens.filter((screen) => screen.locale === locale).length,
    });
  };

  if (pendingAction) {
    const isDelete = pendingAction.kind === "delete";
    const description = isDelete
      ? `Delete locale "${pendingAction.locale}" and all ${pendingAction.screenCount} screens?`
      : `Mirror locale "${pendingAction.locale}" to ${pendingAction.next.toUpperCase()}? Horizontal placement and text alignment will change.`;
    return (
      <ConfirmationDialog
        title={isDelete ? "Delete locale?" : "Change layout direction?"}
        description={description}
        confirmLabel={isDelete ? "Delete locale" : `Make ${pendingAction.next.toUpperCase()}`}
        destructive={isDelete}
        onClose={() => setPendingAction(null)}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action.kind === "direction") {
            if (mutate(() => editorStore.getState().setLocaleDirection(action.locale, action.next))
              && sourceLocale === action.locale) {
              setTargetDirection(action.next);
            }
            return;
          }
          const remainingLocale = locales.find((candidate) => candidate !== action.locale);
          if (mutate(() => editorStore.getState().removeLocale(action.locale))
            && sourceLocale === action.locale && remainingLocale) {
            setSourceLocale(remainingLocale);
            const current = selectEditorLayout(editorStore.getState());
            if (current) setTargetDirection(localeDirection(current, remainingLocale));
          }
        }}
      />
    );
  }

  const errorAlert = error
    ? <p role="alert" className="rounded-lg border border-[var(--editor-color-danger-border)] bg-[var(--editor-color-danger-surface)] px-3 py-2 text-xs text-[color:var(--editor-color-danger-text)]">{error}</p>
    : null;

  if (matrixScreen) {
    const matrix = localeMatrix(layout, matrixScreen, issues);
    const source = matrix.locales[0]!.toUpperCase();
    return (
      <DialogShell
        title="Locale matrix"
        description={localeMatrixSummary(layout, matrix, matrixScreen, specs)}
        ariaLabel="Locale manager"
        closeLabel="Close locale manager"
        widthClass="max-w-3xl"
        focusResetKey={matrix.missing}
        onClose={onClose}
      >
        <div className="space-y-4">
          <button type="button" className={editorUi.buttonGhost} onClick={() => setMatrixScreen(null)}>
            <ArrowLeft size={14} strokeWidth={1.9} /> Locales
          </button>
          {errorAlert}
          <LocaleMatrixTable
            matrix={matrix}
            onCreate={(issue) => mutate(() => editorStore.getState().createScreenFromLocale(issue.sourceScreenId, issue.locale))}
          />
          <p className="text-[11px] leading-4 text-[color:var(--editor-color-text-secondary)]">
            A cell shows whether the screen exists in that locale. + {source} copies the {source} screen: into every size
            under Sync sizes, into the shown size under Separate.
          </p>
        </div>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      title="Locales"
      description="Copy your screens into another language. RTL mirrors the layout once; screenshots aren't flipped."
      ariaLabel="Locale manager"
      closeLabel="Close locale manager"
      widthClass="max-w-2xl"
      onClose={onClose}
    >
      <div className="space-y-5">
        <form className="rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface-subtle)] p-3" onSubmit={createLocale}>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-[color:var(--editor-color-text)]">
            <Languages size={15} strokeWidth={1.9} /> Create locale from an existing set
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
            <label className="space-y-1">
              <span className="block text-[11px] font-medium text-[color:var(--editor-color-text-muted)]">Target locale</span>
              <input
                aria-label="Target locale"
                className={editorUi.field}
                value={targetLocale}
                placeholder="ar"
                onChange={(event) => setTargetLocale(event.target.value)}
              />
            </label>
            <div className="space-y-1">
              <span className="block text-[11px] font-medium text-[color:var(--editor-color-text-muted)]">Copy from</span>
              <MenuSelect
                ariaLabel="Copy from locale"
                value={sourceLocale}
                options={locales.map((locale) => ({ value: locale, label: locale }))}
                onChange={(locale) => {
                  setSourceLocale(locale);
                  setTargetDirection(localeDirection(layout, locale));
                }}
              />
            </div>
            <div className="space-y-1">
              <span className="block text-[11px] font-medium text-[color:var(--editor-color-text-muted)]">Direction</span>
              <SegmentedControl<LayoutDirection>
                label="Layout direction"
                value={targetDirection}
                options={[{ value: "ltr", label: "LTR" }, { value: "rtl", label: "RTL" }]}
                fill
                onChange={setTargetDirection}
              />
            </div>
            <button type="submit" className={cx(editorUi.buttonPrimary, "h-8")}>Create locale</button>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-[color:var(--editor-color-text-secondary)]">
            Choosing a different direction mirrors placement once; screenshots and device content are never reflected.
          </p>
        </form>

        {errorAlert}

        <section aria-label="Project locales">
          <h3 className={`mb-2 ${editorUi.sectionLabel}`}>Current locales</h3>
          <div className="divide-y divide-[var(--editor-color-border-subtle)] rounded-xl border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)]">
            {locales.map((locale) => {
              const screens = layout.screens.filter((screen) => screen.locale === locale);
              const direction = screens[0]!.direction;
              const active = locale === activeLocale;
              return (
                <div key={locale} data-locale={locale} className="flex flex-wrap items-center gap-2 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[color:var(--editor-color-text-strong)]">{locale}</span>
                      <span className="rounded-md bg-[var(--editor-color-surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[color:var(--editor-color-text-muted)]">{direction}</span>
                      {active ? <span className="text-[10px] font-medium text-[color:var(--editor-color-accent-text)]">Active</span> : null}
                    </div>
                    <p className="mt-0.5 text-[11px] text-[color:var(--editor-color-text-secondary)]">{screens.length} {screens.length === 1 ? "screen" : "screens"}</p>
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
                    disabled={locales.length === 1}
                    onClick={() => remove(locale)}
                  >
                    <Trash2 size={14} strokeWidth={1.9} /> Delete
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        <button
          type="button"
          className={editorUi.buttonSecondary}
          onClick={() => setMatrixScreen(layout.screens.find((screen) => screen.id === activeScreenId) ?? layout.screens[0]!)}
        >
          <Table2 size={14} strokeWidth={1.9} /> Locale matrix
        </button>
      </div>
    </DialogShell>
  );
}
