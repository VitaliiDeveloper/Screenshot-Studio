// SPDX-License-Identifier: Apache-2.0
import {
  elementLeaves,
  getLayout,
  layoutLocales,
  slotCounterpart,
  slotScreens,
  type LeafElement,
  type Project,
  type Screen,
  type TextElement,
} from "@screenshot-studio/core/model";
import {
  DEFAULT_STORE_SPECS,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import type { ImageCache } from "@screenshot-studio/core/assets";
import { collectLayoutIssues, visibleLeaves, type ProjectIssue } from "@screenshot-studio/core/validation";
import {
  conciseStoreTargetLabel,
  distinctSizeLabels,
  outputFamilyEditorLabel,
  screenStoreTarget,
  storeTargetDeviceCopy,
} from "./editor-workspace.js";
import { elementLabel } from "@web/lib/panel-helpers.js";

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

/** A screen's exact size, e.g. `6.9"`; null when the store specs no longer list it. */
export function screenTargetLabel(screen: Screen, specs: StoreSpecs): string | null {
  const target = screenStoreTarget(screen, specs);
  return target ? conciseStoreTargetLabel(target, screen.platform, screen.device, specs) : null;
}

export function screenSizeLabel(screen: Screen, specs: StoreSpecs = DEFAULT_STORE_SPECS): string {
  const family = outputFamilyEditorLabel(screen.platform, screen.device, specs);
  const target = screenTargetLabel(screen, specs);
  return target ? `${family} ${target}` : family;
}

function findLeaf(
  project: Project,
  layoutId: string,
  screenId: string,
  elementId: string,
): { screen: Screen; element: LeafElement | undefined } | null {
  const screen = getLayout(project, layoutId).screens.find((candidate) => candidate.id === screenId);
  return screen
    ? { screen, element: screen.elements.flatMap(elementLeaves).find((candidate) => candidate.id === elementId) }
    : null;
}

/** The screen and text layer a text-overflow issue points at, or null once either is gone. */
export function overflowTarget(
  project: Project,
  issue: Extract<ProjectIssue, { kind: "text-overflow" }>,
): { screen: Screen; element: TextElement } | null {
  const found = findLeaf(project, issue.layoutId, issue.screenId, issue.elementId);
  return found?.element?.type === "text" ? { screen: found.screen, element: found.element } : null;
}

export type MissingImageLayer = Extract<LeafElement, { type: "screenshot" | "image" | "device-frame" }>;

/**
 * The screen and media layer a missing-image issue points at (null element: the background), or
 * null once either is gone.
 */
export function missingImageTarget(
  project: Project,
  issue: Extract<ProjectIssue, { kind: "missing-image" }>,
): { screen: Screen; element: MissingImageLayer | null } | null {
  if (issue.elementId === null) {
    const screen = getLayout(project, issue.layoutId).screens.find((candidate) => candidate.id === issue.screenId);
    return screen ? { screen, element: null } : null;
  }
  const found = findLeaf(project, issue.layoutId, issue.screenId, issue.elementId);
  const element = found?.element;
  return element && (element.type === "screenshot" || element.type === "image" || element.type === "device-frame")
    ? { screen: found.screen, element }
    : null;
}

/** Project-folder images that visible layers of any layout still reference but failed to load. */
export function missingProjectImages(project: Project, images: ImageCache): string[] {
  const imageMissing = (assetUrl: string) => !images.has(assetUrl);
  return [...new Set(project.layouts.flatMap((layout) => collectLayoutIssues(project, layout.id, { imageMissing })
    .flatMap((issue) => issue.kind === "missing-image" ? [issue.assetUrl] : [])))];
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
  const multipleLocales = layoutLocales(layout).length > 1;
  if (issue.kind === "missing-image") {
    const target = missingImageTarget(project, issue);
    if (!target) return null;
    return {
      title: "Image missing from the project folder",
      detail: [
        issue.assetUrl,
        target.element ? elementLabel(target.element) : "Background",
        target.screen.name,
        screenSizeLabel(target.screen, specs),
        ...(multipleLocales ? [target.screen.locale] : []),
      ].join(" · "),
      fixLabel: "Replace",
    };
  }
  const target = overflowTarget(project, issue);
  if (!target) return null;
  const { screen, element } = target;
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

export type TextSizeState = "checking" | "fits" | "overflows" | "hidden" | "unmatched";

export interface TextSizeStatusRow {
  screen: Screen;
  label: string;
  /** The size being edited. */
  current: boolean;
  /** The matching text layer on this size; null when none matches. */
  element: TextElement | null;
  state: TextSizeState;
}

/**
 * Status by size for one text layer: every exact-size screen of its slot, read from the same
 * issues list as Issues so fit is never measured on a second path. `measured` is false until
 * project fonts have settled, so no size reads as fitting on fallback metrics.
 */
export function textSizeStatus(
  project: Project,
  layoutId: string,
  screenId: string,
  elementId: string,
  issues: readonly ProjectIssue[],
  measured: boolean,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): TextSizeStatusRow[] {
  const layout = getLayout(project, layoutId);
  const source = layout.screens.find((candidate) => candidate.id === screenId);
  if (!source) return [];
  const screens = slotScreens(layout, source);
  const labels = distinctSizeLabels(
    screens.map((screen) => {
      const target = screenStoreTarget(screen, specs);
      const label = target ? storeTargetDeviceCopy(target, screen.platform, screen.device, specs).title : screen.name;
      return { screen, label };
    }),
  );
  return screens.map((screen, index) => {
    const counterpart = slotCounterpart(source, elementId, screen);
    const element = counterpart?.type === "text" ? counterpart : null;
    const state: TextSizeState = !element
      ? "unmatched"
      : !visibleLeaves(screen).some((leaf) => leaf.id === element.id)
        ? "hidden"
        : !measured
          ? "checking"
          : issues.some((issue) =>
            issue.kind === "text-overflow" && issue.screenId === screen.id && issue.elementId === element.id
          )
            ? "overflows"
            : "fits";
    return {
      screen,
      label: labels[index]!,
      current: screen.id === source.id,
      element,
      state,
    };
  });
}
