// SPDX-License-Identifier: Apache-2.0
"use client";

import type { BundleEntry } from "@screenshot-studio/core/export";
import { cx, editorUi } from "./editor-ui";
import {
  exportPathPreview,
  exportSelectionSummary,
  plural,
  type ExportChecks,
  type ExportLocaleRow,
  type ExportSizeRow,
} from "./export-dialog-model";

const listClass = "divide-y divide-[var(--editor-color-surface-muted)] overflow-hidden rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)]";
const checkboxClass = "size-4 shrink-0 rounded border-[var(--editor-color-border)]";

/** Store images scope (Handoff 6i): exact sizes and locales to write, and where each file lands in the ZIP. */
export function ExportDialogSelection({
  sizeRows,
  localeRows,
  checks,
  checked,
  disabled,
  showPaths,
  zipFilename,
  onToggleSize,
  onToggleLocale,
}: {
  sizeRows: readonly ExportSizeRow[];
  localeRows: readonly ExportLocaleRow[];
  checks: ExportChecks;
  checked: readonly BundleEntry[];
  disabled: boolean;
  showPaths: boolean;
  zipFilename: string;
  onToggleSize: (key: string) => void;
  onToggleLocale: (locale: string) => void;
}) {
  const paths = exportPathPreview(checked);
  return (
    <>
      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-1.5">
        <legend className={cx(editorUi.sectionLabel, "mb-1.5")}>Destinations · exact store sizes</legend>
        <ul aria-label="Destinations" className={listClass}>
          {sizeRows.map((row) => {
            const on = checks.sizes.has(row.key);
            return (
              <li key={row.key}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-xs">
                  <input type="checkbox" className={checkboxClass} checked={on} onChange={() => onToggleSize(row.key)} />
                  <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--editor-color-text-strong)]">{row.label}</span>
                  {on && row.blockers > 0 ? (
                    <span className="shrink-0 text-[color:var(--editor-color-danger-text)]">{plural(row.blockers, "blocker")}</span>
                  ) : on && row.warnings > 0 ? (
                    <span className="shrink-0 text-[color:var(--editor-color-warning-text)]">{plural(row.warnings, "warning")}</span>
                  ) : null}
                  <span className="shrink-0 font-mono tabular-nums text-[color:var(--editor-color-text-secondary)]">
                    {row.width} × {row.height}
                  </span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-[color:var(--editor-color-text-secondary)]">
                    {on ? plural(row.files, "file") : "—"}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset disabled={disabled} className="flex min-w-0 flex-col">
        <legend className={cx(editorUi.sectionLabel, "mb-1.5")}>Locales</legend>
        <ul aria-label="Locales" className="flex flex-wrap gap-1.5">
          {localeRows.map((row) => (
            <li key={row.locale}>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-2.5 py-1.5 text-xs">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={checks.locales.has(row.locale)}
                  onChange={() => onToggleLocale(row.locale)}
                />
                <span className="font-medium text-[color:var(--editor-color-text-strong)]">{row.locale}</span>
                {row.missingScreens > 0 ? (
                  <span className="text-[color:var(--editor-color-danger-text)]">
                    {row.missingScreens === 1 ? "1 screen missing" : `${row.missingScreens} screens missing`}
                  </span>
                ) : null}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="flex min-w-0 flex-col gap-1.5">
        <p className={editorUi.sectionLabel}>Path preview</p>
        {showPaths && paths.length > 0 ? (
          <ul aria-label="Path preview" className="rounded-[var(--editor-radius-control)] border border-[var(--editor-color-border)] bg-[var(--editor-color-surface)] px-3 py-2 font-mono text-[11px] leading-5 text-[color:var(--editor-color-text-default)]">
            {paths.map((path) => <li key={path} className="truncate" title={path}>{path}</li>)}
          </ul>
        ) : null}
        <p className="text-xs text-[color:var(--editor-color-text-secondary)]">
          {exportSelectionSummary(checked)}
          {showPaths ? ` · inside ${zipFilename}` : " · Web Share adds a share page around these images"}
        </p>
      </div>
    </>
  );
}
