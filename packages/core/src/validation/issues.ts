// SPDX-License-Identifier: Apache-2.0
import {
  elementLeaves,
  getLayout,
  missingLocaleScreens,
  type Project,
  type Screen,
  type TextElement,
} from "@screenshot-studio/core/model";

export type IssueLevel = "blocker" | "warning";

export type ProjectIssue =
  | {
    kind: "missing-locale-screen";
    id: string;
    level: "blocker";
    layoutId: string;
    /** Locale that lacks the screen. */
    locale: string;
    sourceLocale: string;
    sourceScreenId: string;
    allSizes: boolean;
  }
  | {
    kind: "text-overflow";
    id: string;
    level: "warning";
    layoutId: string;
    screenId: string;
    elementId: string;
  };

export interface IssueChecks {
  /**
   * Shared-renderer text measurement (`textOverflows` from the engine). Omit it until project fonts
   * have settled so fallback-font metrics never produce overflow issues.
   */
  textOverflows?: (element: TextElement, screen: Screen) => boolean;
}

/**
 * The single validation source for Issues and Export: issues are derived from the project on
 * demand and never persisted. Blockers come first; each kind keeps the layout's screen order.
 */
export function collectLayoutIssues(
  project: Project,
  layoutId: string,
  checks: IssueChecks = {},
): ProjectIssue[] {
  const layout = getLayout(project, layoutId);
  const missing = missingLocaleScreens(layout).map((entry): ProjectIssue => ({
    kind: "missing-locale-screen",
    id: `missing-locale-screen:${entry.locale}:${entry.sourceScreenId}`,
    level: "blocker",
    layoutId: layout.id,
    ...entry,
  }));
  const textOverflows = checks.textOverflows;
  const overflows = textOverflows
    ? layout.screens.flatMap((screen) => screen.elements
      .filter((element) => element.visible)
      .flatMap(elementLeaves)
      .filter((leaf): leaf is TextElement =>
        leaf.type === "text" && leaf.visible && textOverflows(leaf, screen)
      )
      .map((leaf): ProjectIssue => ({
        kind: "text-overflow",
        id: `text-overflow:${screen.id}:${leaf.id}`,
        level: "warning",
        layoutId: layout.id,
        screenId: screen.id,
        elementId: leaf.id,
      })))
    : [];
  return [...missing, ...overflows];
}
