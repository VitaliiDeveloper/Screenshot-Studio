// SPDX-License-Identifier: Apache-2.0
import {
  Screen as ScreenSchema,
  type Project as ProjectModel,
  type Screen,
} from "./schema.js";
import { getLayout, replaceLayout } from "./project-layout.js";
import {
  cloneScreenWithFreshIds,
  parseScreenPlacement,
  removeScreenFromProject,
} from "./project-screen-ops.js";
import {
  fitElementsToArtboard,
  resizeScreenArtboard,
} from "./project-artboard-ops.js";

export interface StoreTargetDimensions {
  id: string;
  width: number;
  height: number;
}

const WATCHOS_AUTHORING_SCALE = 3.5;

/**
 * Store outputs author at their exact target size by default. watchOS uses a larger proportional
 * canvas; the shared export path still renders it to the exact target dimensions.
 */
function deriveAuthoringArtboard(
  placement: Pick<Screen, "platform" | "device">,
  target: StoreTargetDimensions,
): { width: number; height: number } {
  if (placement.platform !== "apple" || placement.device !== "watchos") {
    return { width: target.width, height: target.height };
  }

  const artboard = {
    width: target.width * WATCHOS_AUTHORING_SCALE,
    height: target.height * WATCHOS_AUTHORING_SCALE,
  };
  if (!Number.isInteger(artboard.width) || !Number.isInteger(artboard.height)) {
    throw new Error(
      `Cannot derive a ${WATCHOS_AUTHORING_SCALE}x watchOS authoring artboard from target `
      + `"${target.width}x${target.height}": derived artboard must use integer dimensions`,
    );
  }

  return artboard;
}

/** Resize every screen in one target-specific store output set. */
export function resizeStoreOutputArtboards(
  project: ProjectModel,
  layoutId: string,
  sourceScreenId: string,
  target: { width: number; height: number },
): ProjectModel {
  const layout = getLayout(project, layoutId);
  const source = layout.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);

  let next = project;
  for (const screen of layout.screens) {
    if (
      screen.platform === source.platform
      && screen.device === source.device
      && screen.locale === source.locale
      && screen.storeTargetId === source.storeTargetId
    ) {
      next = resizeScreenArtboard(next, layoutId, screen.id, target);
    }
  }
  return next;
}

export interface StoreTargetVariantResult {
  project: ProjectModel;
  variant: Screen;
  created: boolean;
}

export interface StoreOutputFamilyResult {
  project: ProjectModel;
  firstScreen: Screen;
  created: boolean;
}

/**
 * Create one independent platform/device output set for the source locale. Every root screen in
 * the source family is copied with fresh ids and fitted to the destination master artboard; size
 * variants remain family-local and are deliberately not copied.
 */
export function ensureStoreOutputFamily(
  project: ProjectModel,
  layoutId: string,
  sourceScreenId: string,
  platform: string,
  device: string,
  leadTarget: StoreTargetDimensions,
): StoreOutputFamilyResult {
  const placement = parseScreenPlacement(platform, device);
  if (!placement) throw new Error(`Unsupported platform/device pair: ${platform}/${device}`);

  const layout = getLayout(project, layoutId);
  const source = layout.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);
  const sourceRootId = source.variantOf ?? source.id;
  const sourceRoot = layout.screens.find((screen) => screen.id === sourceRootId);
  if (!sourceRoot || sourceRoot.variantOf !== undefined) {
    throw new Error(`Invalid root screen "${sourceRootId}"`);
  }

  const existing = layout.screens.find((screen) =>
    screen.variantOf === undefined
    && screen.platform === placement.platform
    && screen.device === placement.device
    && screen.locale === sourceRoot.locale,
  );
  if (existing) return { project, firstScreen: existing, created: false };

  const sourceRoots = layout.screens.filter((screen) =>
    screen.variantOf === undefined
    && screen.platform === sourceRoot.platform
    && screen.device === sourceRoot.device
    && screen.locale === sourceRoot.locale,
  );
  if (sourceRoots.length === 0) throw new Error(`No source output screens for "${sourceRootId}"`);

  const masterArtboard = deriveAuthoringArtboard(placement, leadTarget);
  const copies = sourceRoots.map((root) => {
    const copy = cloneScreenWithFreshIds(root);
    return ScreenSchema.parse({
      ...copy,
      ...placement,
      name: root.name,
      variantOf: undefined,
      storeTargetId: undefined,
      artboard: masterArtboard,
      elements: fitElementsToArtboard(copy.elements, root.artboard, masterArtboard),
    });
  });
  const next = replaceLayout(project, { ...layout, screens: [...layout.screens, ...copies] });
  return { project: next, firstScreen: copies[0]!, created: true };
}

/** Create one independent target copy, or return the existing variant idempotently. */
export function ensureStoreTargetVariant(
  project: ProjectModel,
  layoutId: string,
  sourceScreenId: string,
  target: StoreTargetDimensions,
): StoreTargetVariantResult {
  const layout = getLayout(project, layoutId);
  const source = layout.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);
  const rootId = source.variantOf ?? source.id;
  const root = layout.screens.find((screen) => screen.id === rootId);
  if (!root || root.variantOf !== undefined) throw new Error(`Invalid root screen "${rootId}"`);

  const existing = layout.screens.find((screen) =>
    screen.variantOf === root.id && screen.storeTargetId === target.id,
  );
  if (existing) return { project, variant: existing, created: false };

  const copy = cloneScreenWithFreshIds(root);
  const targetSetScreen = layout.screens.find((screen) =>
    screen.platform === root.platform
    && screen.device === root.device
    && screen.locale === root.locale
    && screen.storeTargetId === target.id
  );
  const variantArtboard = targetSetScreen
    ? { ...targetSetScreen.artboard }
    : deriveAuthoringArtboard(root, target);
  const variant = ScreenSchema.parse({
    ...copy,
    name: root.name,
    variantOf: root.id,
    storeTargetId: target.id,
    artboard: variantArtboard,
    elements: fitElementsToArtboard(copy.elements, root.artboard, variantArtboard),
  });
  const next = replaceLayout(project, { ...layout, screens: [...layout.screens, variant] });
  return { project: next, variant, created: true };
}

export function removeStoreTargetVariant(
  project: ProjectModel,
  layoutId: string,
  rootScreenId: string,
  storeTargetId: string,
): ProjectModel {
  const layout = getLayout(project, layoutId);
  const variant = layout.screens.find((screen) =>
    screen.variantOf === rootScreenId && screen.storeTargetId === storeTargetId,
  );
  if (!variant) throw new Error(`Store target variant "${storeTargetId}" does not exist`);
  return removeScreenFromProject(project, layoutId, variant.id);
}
