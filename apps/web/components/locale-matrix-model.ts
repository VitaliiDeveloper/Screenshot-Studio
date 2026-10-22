// SPDX-License-Identifier: Apache-2.0
import type { StoreSpecs } from "@screenshot-studio/core/export";
import {
  layoutLocales,
  screenSetModeFor,
  type DesignLayout,
  type Screen,
  type ScreenSetMode,
} from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { screenSizeLabel } from "@web/lib/editor/editor-issues";
import { outputFamilyEditorLabel } from "@web/lib/editor/editor-workspace";

export type MissingLocaleIssue = Extract<ProjectIssue, { kind: "missing-locale-screen" }>;

export interface LocaleMatrixRow {
  screen: Screen;
  /** Per locale: the Issues entry that reports this screen missing there, or null when it exists. */
  cells: (MissingLocaleIssue | null)[];
}

export interface LocaleMatrix {
  locales: string[];
  /** The source locale's screen structure for the shown size. */
  structure: ScreenSetMode;
  rows: LocaleMatrixRow[];
  /** Missing cells shown. */
  missing: number;
  /** Missing-locale issues of the layout that other sizes or destinations own. */
  elsewhere: number;
}

/**
 * The first locale's screens in the shown screen's exact size, against every locale. Each cell
 * matches the validation engine's missing-locale issues: it is missing exactly where an issue names
 * it. Sync sizes reports a slot once, on its primary screen, so a variant row is missing together
 * with its primary. Issues in other sizes or destinations are counted in `elsewhere`.
 */
export function localeMatrix(
  layout: DesignLayout,
  shown: Screen,
  issues: readonly ProjectIssue[],
): LocaleMatrix {
  const locales = layoutLocales(layout);
  const reported = issues.filter((issue): issue is MissingLocaleIssue => issue.kind === "missing-locale-screen");
  const rows = layout.screens
    .filter((screen) =>
      screen.locale === locales[0]
      && screen.platform === shown.platform
      && screen.device === shown.device
      && screen.storeTargetId === shown.storeTargetId
    )
    .map((screen): LocaleMatrixRow => ({
      screen,
      cells: locales.map((locale) =>
        reported.find((issue) =>
          issue.locale === locale
          && (issue.sourceScreenId === screen.id || (issue.allSizes && issue.sourceScreenId === screen.variantOf))
        ) ?? null
      ),
    }));
  const missing = rows.flatMap((row) => row.cells).filter(Boolean).length;
  return {
    locales,
    structure: screenSetModeFor(layout, { platform: shown.platform, device: shown.device, locale: locales[0]! }),
    rows,
    missing,
    elsewhere: reported.length - missing,
  };
}

/** `Default · Separate · iPhone Dynamic Island · Medium · 3 screens × 2 locales · 1 missing · 2 in other sizes`. */
export function localeMatrixSummary(
  layout: DesignLayout,
  matrix: LocaleMatrix,
  shown: Screen,
  specs: StoreSpecs,
): string {
  const synchronized = matrix.structure === "synchronized";
  return [
    layout.name,
    synchronized ? "Sync sizes" : "Separate",
    synchronized ? outputFamilyEditorLabel(shown.platform, shown.device, specs) : screenSizeLabel(shown, specs),
    `${matrix.rows.length} ${matrix.rows.length === 1 ? "screen" : "screens"} × ${matrix.locales.length} ${matrix.locales.length === 1 ? "locale" : "locales"}`,
    `${matrix.missing} missing`,
    ...(matrix.elsewhere > 0 ? [`${matrix.elsewhere} in other sizes`] : []),
  ].join(" · ");
}
