// SPDX-License-Identifier: Apache-2.0
import {
  elementLeaves,
  getLayout,
  layoutLocales,
  type Project,
  type Screen,
  type TextElement,
} from "@screenshot-studio/core/model";
import {
  DEFAULT_STORE_SPECS,
  findStoreTarget,
  leadStoreSizeId,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import type { ProjectIssue } from "@screenshot-studio/core/validation";
import { conciseStoreTargetLabel, outputFamilyEditorLabel } from "./editor-workspace.js";
import { elementLabel } from "./panel-helpers.js";

export interface IssueCounts {
  blockers: number;
  warnings: number;
}

export function countIssues(issues: readonly ProjectIssue[]): IssueCounts {
  const blockers = issues.filter((issue) => issue.level === "blocker").length;
  return { blockers, warnings: issues.length - blockers };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "2 blockers · 1 warning", or "No issues". */
export function issueSummary({ blockers, warnings }: IssueCounts): string {
  const parts = [
    ...(blockers > 0 ? [plural(blockers, "blocker")] : []),
    ...(warnings > 0 ? [plural(warnings, "warning")] : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : "No issues";
}

function screenSizeLabel(screen: Screen, specs: StoreSpecs): string {
  const family = outputFamilyEditorLabel(screen.platform, screen.device, specs);
  try {
    const targetId = screen.storeTargetId ?? leadStoreSizeId(specs, screen.platform, screen.device);
    const target = findStoreTarget(specs, screen.platform, screen.device, targetId);
    return `${family} ${conciseStoreTargetLabel(target, screen.platform, screen.device, specs)}`;
  } catch {
    return family;
  }
}

/** The screen and text layer a text-overflow issue points at, or null once either is gone. */
export function overflowTarget(
  project: Project,
  issue: Extract<ProjectIssue, { kind: "text-overflow" }>,
): { screen: Screen; element: TextElement } | null {
  const screen = getLayout(project, issue.layoutId).screens
    .find((candidate) => candidate.id === issue.screenId);
  const element = screen?.elements.flatMap(elementLeaves)
    .find((candidate) => candidate.id === issue.elementId);
  return screen && element?.type === "text" ? { screen, element } : null;
}

export interface IssueRowCopy {
  title: string;
  detail: string;
  fixLabel: string;
}

/** Row copy for the Issues list; null when the issue no longer resolves in the project. */
export function issueRowCopy(
  project: Project,
  issue: ProjectIssue,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): IssueRowCopy | null {
  const layout = getLayout(project, issue.layoutId);
  if (issue.kind === "missing-locale-screen") {
    const source = layout.screens.find((screen) => screen.id === issue.sourceScreenId);
    if (!source) return null;
    const scope = issue.allSizes
      ? `${outputFamilyEditorLabel(source.platform, source.device, specs)}, all sizes`
      : screenSizeLabel(source, specs);
    return {
      title: `Screen missing in locale ${issue.locale}`,
      detail: `${source.name} · ${scope}`,
      fixLabel: `Create from ${issue.sourceLocale}`,
    };
  }
  const target = overflowTarget(project, issue);
  if (!target) return null;
  const { screen, element } = target;
  const multipleLocales = layoutLocales(layout).length > 1;
  return {
    title: "Text overflows its layer box",
    detail: [
      elementLabel(element),
      screen.name,
      screenSizeLabel(screen, specs),
      ...(multipleLocales ? [screen.locale] : []),
    ].join(" · "),
    fixLabel: "Fit text",
  };
}
