// SPDX-License-Identifier: Apache-2.0
import {
  elementLeaves,
  getLayout,
  missingLocaleScreens,
  type LeafElement,
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
    kind: "missing-image";
    id: string;
    level: "blocker";
    layoutId: string;
    screenId: string;
    /** The screenshot, image, or device-frame layer; null for the screen background. */
    elementId: string | null;
    assetUrl: string;
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
  /**
   * Whether a project image failed to load from the project folder (the host's image cache).
   * Omit it until the cache has loaded so images still in flight never report as missing.
   */
  imageMissing?: (assetUrl: string) => boolean;
}

/** Leaves the renderer draws: a hidden group or layer hides everything under it. */
export function visibleLeaves(screen: Screen): LeafElement[] {
  return screen.elements
    .filter((element) => element.visible)
    .flatMap(elementLeaves)
    .filter((leaf) => leaf.visible);
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
  const imageMissing = checks.imageMissing;
  const missingImages = imageMissing
    ? layout.screens.flatMap((screen) => [
      ...(screen.background.type === "image" ? [{ elementId: null, assetUrl: screen.background.assetUrl }] : []),
      ...visibleLeaves(screen).flatMap((leaf) =>
        (leaf.type === "screenshot" || leaf.type === "image" || leaf.type === "device-frame") && leaf.assetUrl
          ? [{ elementId: leaf.id, assetUrl: leaf.assetUrl }]
          : []
      ),
    ]
      .filter(({ assetUrl }) => imageMissing(assetUrl))
      .map(({ elementId, assetUrl }): ProjectIssue => ({
        kind: "missing-image",
        id: `missing-image:${screen.id}:${elementId ?? "background"}`,
        level: "blocker",
        layoutId: layout.id,
        screenId: screen.id,
        elementId,
        assetUrl,
      })))
    : [];
  const textOverflows = checks.textOverflows;
  const overflows = textOverflows
    ? layout.screens.flatMap((screen) => visibleLeaves(screen)
      .filter((leaf): leaf is TextElement => leaf.type === "text" && textOverflows(leaf, screen))
      .map((leaf): ProjectIssue => ({
        kind: "text-overflow",
        id: `text-overflow:${screen.id}:${leaf.id}`,
        level: "warning",
        layoutId: layout.id,
        screenId: screen.id,
        elementId: leaf.id,
      })))
    : [];
  return [...missing, ...missingImages, ...overflows];
}
