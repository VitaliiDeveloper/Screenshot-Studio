// SPDX-License-Identifier: Apache-2.0
import {
  elementLeaves,
  getLayout,
  missingLocaleScreens,
  nativeCroppedSize,
  nativePlacements,
  rectsOverlap,
  sameScreenGroup,
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
  }
  | {
    kind: "unequal-connected-artboard";
    id: string;
    level: "warning";
    layoutId: string;
    screenId: string;
    elementId: null;
    /** The strip's first screen, which the rest of the strip is compared with. */
    stripArtboard: { width: number; height: number };
  }
  | {
    kind: "native-placement";
    id: string;
    level: "blocker";
    layoutId: string;
    screenId: string;
    elementId: string;
    /** Every reason the export check would reject this 1:1 screenshot. */
    reasons: NativePlacementReason[];
  };

export type NativePlacementReason =
  | "export-scale"
  | "fractional-position"
  | "transform"
  | "effect"
  | "insets-exceed-image"
  | "size-mismatch"
  | "off-artboard"
  | "covered";

const NATIVE_REASON_TEXT: Record<NativePlacementReason, string> = {
  "export-scale": "the artboard is not at the export size, so export would scale it",
  "fractional-position": "its position is not on whole pixels",
  transform: "it or its group is rotated or semi-transparent",
  effect: "it has a corner radius or blur",
  "insets-exceed-image": "its crop insets remove the whole image",
  "size-mismatch": "its box differs from the cropped screenshot size",
  "off-artboard": "it is not entirely on the artboard",
  covered: "another layer is drawn over it",
};

/** One sentence for a native-placement issue, shared by the editor and `screenshots check`. */
export function nativePlacementMessage(reasons: readonly NativePlacementReason[]): string {
  return `1:1 screenshot cannot be exported pixel-exact: ${reasons.map((reason) => NATIVE_REASON_TEXT[reason]).join("; ")}`;
}

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
  /** Decoded pixel size of a project image; omit or return undefined until it is known. */
  imageSize?: (assetUrl: string) => { width: number; height: number } | undefined;
  /** Export pixel ratio of a screen (`exportPixelRatio`); omit or return undefined when unknown. */
  exportScale?: (screen: Screen) => number | undefined;
}

function nativePlacementReasons(screen: Screen, checks: IssueChecks) {
  const scale = checks.exportScale?.(screen);
  return nativePlacements(screen).flatMap((placement) => {
    const { element } = placement;
    const reasons: NativePlacementReason[] = [];
    if (scale !== undefined && Math.abs(scale - 1) > 1e-9) reasons.push("export-scale");
    if (!Number.isInteger(placement.x) || !Number.isInteger(placement.y)) reasons.push("fractional-position");
    if (placement.rotations.some((rotation) => rotation % 360 !== 0)
      || placement.opacities.some((opacity) => opacity !== 1)) reasons.push("transform");
    if (element.cornerRadius > 0 || (element.blur ?? 0) > 0) reasons.push("effect");
    const image = checks.imageSize?.(element.assetUrl);
    if (image) {
      const cropped = nativeCroppedSize(image, element.nativeInsets);
      if (cropped.width === 0 || cropped.height === 0) reasons.push("insets-exceed-image");
      else if (cropped.width !== element.width || cropped.height !== element.height) reasons.push("size-mismatch");
    }
    const box = { x: placement.x, y: placement.y, width: element.width, height: element.height };
    if (box.x < 0 || box.y < 0 || box.x + box.width > screen.artboard.width
      || box.y + box.height > screen.artboard.height) reasons.push("off-artboard");
    if (placement.above.some((rect) => rectsOverlap(box, rect))) reasons.push("covered");
    return reasons.length > 0 ? [{ elementId: element.id, reasons }] : [];
  });
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
  const unequalArtboards = layout.mode === "connected"
    ? layout.screens.flatMap((screen): ProjectIssue[] => {
      const { artboard } = layout.screens.find((candidate) => sameScreenGroup(candidate, screen))!;
      return artboard.width === screen.artboard.width && artboard.height === screen.artboard.height
        ? []
        : [{
          kind: "unequal-connected-artboard",
          id: `unequal-connected-artboard:${screen.id}`,
          level: "warning",
          layoutId: layout.id,
          screenId: screen.id,
          elementId: null,
          stripArtboard: artboard,
        }];
    })
    : [];
  const nativeIssues = layout.screens.flatMap((screen) => nativePlacementReasons(screen, checks)
    .map(({ elementId, reasons }): ProjectIssue => ({
      kind: "native-placement",
      id: `native-placement:${screen.id}:${elementId}`,
      level: "blocker",
      layoutId: layout.id,
      screenId: screen.id,
      elementId,
      reasons,
    })));
  return [...missing, ...missingImages, ...nativeIssues, ...overflows, ...unequalArtboards];
}
