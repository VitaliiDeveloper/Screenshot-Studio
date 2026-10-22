// SPDX-License-Identifier: Apache-2.0
import {
  layoutLocales,
  screenSetModeFor,
  type DesignLayout,
  type Screen,
  type ScreenSetMode,
} from "@screenshot-studio/core/model";
import type { ProjectIssue } from "@screenshot-studio/core/validation";

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
}

/**
 * The first locale's screens in the active screen's exact size, against every locale. A cell is
 * missing exactly where the validation engine's missing-locale issue says so, so the matrix and
 * Issues cannot disagree. Sync sizes reports a slot once, on its primary screen, so a variant row
 * is missing together with its primary.
 */
export function localeMatrix(
  layout: DesignLayout,
  active: Screen,
  issues: readonly ProjectIssue[],
): LocaleMatrix {
  const locales = layoutLocales(layout);
  const missing = issues.filter((issue): issue is MissingLocaleIssue => issue.kind === "missing-locale-screen");
  const rows = layout.screens
    .filter((screen) =>
      screen.locale === locales[0]
      && screen.platform === active.platform
      && screen.device === active.device
      && screen.storeTargetId === active.storeTargetId
    )
    .map((screen): LocaleMatrixRow => ({
      screen,
      cells: locales.map((locale) =>
        missing.find((issue) =>
          issue.locale === locale
          && (issue.sourceScreenId === screen.id || (issue.allSizes && issue.sourceScreenId === screen.variantOf))
        ) ?? null
      ),
    }));
  return {
    locales,
    structure: screenSetModeFor(layout, { platform: active.platform, device: active.device, locale: locales[0]! }),
    rows,
  };
}
