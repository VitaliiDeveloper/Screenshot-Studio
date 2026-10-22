// SPDX-License-Identifier: Apache-2.0
"use client";

import { Check } from "lucide-react";
import { cx, editorUi } from "./editor-ui";
import type { LocaleMatrix, MissingLocaleIssue } from "./locale-matrix-model";

const CELL = "flex h-9 items-center justify-center gap-1.5 rounded-[var(--editor-radius-control)] border text-xs";

/** Screens × locales for the shown size. A missing cell offers a copy from the source locale. */
export function LocaleMatrixTable({
  matrix,
  onCreate,
}: {
  matrix: LocaleMatrix;
  onCreate: (issue: MissingLocaleIssue) => void;
}) {
  const [sourceLocale] = matrix.locales;
  if (matrix.rows.length === 0) {
    return (
      <p className="text-xs text-[color:var(--editor-color-text-secondary)]">
        {sourceLocale!.toUpperCase()} has no screens in this size.
      </p>
    );
  }
  return (
    <table className="w-full border-separate border-spacing-2 text-left">
      <thead>
        <tr>
          <th scope="col" className="w-40"><span className="sr-only">Screen</span></th>
          {matrix.locales.map((locale, index) => {
            const missing = matrix.rows.filter((row) => row.cells[index]).length;
            return (
              <th key={locale} scope="col" className="px-1 font-normal">
                <span className="block text-[length:var(--editor-font-control-emphasis-size)] font-semibold text-[color:var(--editor-color-text-strong)]">
                  {locale.toUpperCase()}
                </span>
                {index === 0 ? (
                  <span className="text-[length:var(--editor-font-label-size)] text-[color:var(--editor-color-text-secondary)]">source</span>
                ) : missing > 0 ? (
                  <span className="text-[length:var(--editor-font-label-size)] text-[color:var(--editor-color-warning-text)]">{missing} missing</span>
                ) : null}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {matrix.rows.map(({ screen, cells }) => (
          <tr key={screen.id}>
            <th scope="row" className="truncate px-1 text-[length:var(--editor-font-control-emphasis-size)] font-medium text-[color:var(--editor-color-text-default)]">
              {screen.name}
            </th>
            {cells.map((issue, index) => (
              <td key={matrix.locales[index]}>
                {issue ? (
                  <div className={cx(CELL, "border-[var(--editor-color-warning-border)] bg-[var(--editor-color-warning-surface)]")}>
                    <button
                      type="button"
                      className={cx(editorUi.buttonGhostAccent, "h-6 font-semibold")}
                      aria-label={`Create ${screen.name} in ${issue.locale} from ${issue.sourceLocale}`}
                      onClick={() => onCreate(issue)}
                    >
                      + {issue.sourceLocale.toUpperCase()}
                    </button>
                  </div>
                ) : (
                  <div className={cx(CELL, "border-[var(--editor-color-border)] text-[color:var(--editor-color-text-secondary)]")}>
                    <Check size={13} strokeWidth={2} aria-hidden="true" /> exists
                  </div>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
