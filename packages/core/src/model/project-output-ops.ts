// SPDX-License-Identifier: Apache-2.0
import {
  Screen as ScreenSchema,
  type Project as ProjectModel,
  type Screen,
} from "./schema.js";
import { recomputeManifests } from "./project-manifest.js";
import {
  cloneScreenWithFreshIds,
  parseScreenPlacement,
  removeScreenFromProject,
} from "./project-screen-ops.js";
import { fitElementsToArtboard, resizeRootArtboard } from "./project-artboard-ops.js";

export interface StoreTargetDimensions {
  id: string;
  width: number;
  height: number;
}

const WATCHOS_AUTHORING_MASTER_SCALE = 3;

/**
 * New output families author at their lead store size by default. watchOS uses a larger editor
 * master; the shared export path still renders it to the exact target dimensions.
 */
function deriveInitialAuthoringArtboard(
  placement: Pick<Screen, "platform" | "device">,
  leadTarget: StoreTargetDimensions,
): { width: number; height: number } {
  if (placement.platform !== "apple" || placement.device !== "watchos") {
    return { width: leadTarget.width, height: leadTarget.height };
  }

  return {
    width: leadTarget.width * WATCHOS_AUTHORING_MASTER_SCALE,
    height: leadTarget.height * WATCHOS_AUTHORING_MASTER_SCALE,
  };
}

/** Resize every root/master in one store output set; size variants remain independent. */
export function resizeStoreOutputArtboards(
  project: ProjectModel,
  sourceScreenId: string,
  target: { width: number; height: number },
): ProjectModel {
  const source = project.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);
  if (source.variantOf !== undefined || source.storeTargetId !== undefined) {
    throw new Error("Exact store-target variants have fixed artboards");
  }

  let next = project;
  for (const screen of project.screens) {
    if (
      screen.variantOf === undefined
      && screen.platform === source.platform
      && screen.device === source.device
      && screen.locale === source.locale
    ) {
      next = resizeRootArtboard(next, screen.id, target);
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
  sourceScreenId: string,
  platform: string,
  device: string,
  leadTarget: StoreTargetDimensions,
): StoreOutputFamilyResult {
  const placement = parseScreenPlacement(platform, device);
  if (!placement) throw new Error(`Unsupported platform/device pair: ${platform}/${device}`);

  const source = project.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);
  const sourceRootId = source.variantOf ?? source.id;
  const sourceRoot = project.screens.find((screen) => screen.id === sourceRootId);
  if (!sourceRoot || sourceRoot.variantOf !== undefined) {
    throw new Error(`Invalid root screen "${sourceRootId}"`);
  }

  const existing = project.screens.find((screen) =>
    screen.variantOf === undefined
    && screen.platform === placement.platform
    && screen.device === placement.device
    && screen.locale === sourceRoot.locale,
  );
  if (existing) return { project, firstScreen: existing, created: false };

  const sourceRoots = project.screens.filter((screen) =>
    screen.variantOf === undefined
    && screen.platform === sourceRoot.platform
    && screen.device === sourceRoot.device
    && screen.locale === sourceRoot.locale,
  );
  if (sourceRoots.length === 0) throw new Error(`No source output screens for "${sourceRootId}"`);

  const masterArtboard = deriveInitialAuthoringArtboard(placement, leadTarget);
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
  const next = recomputeManifests({ ...project, screens: [...project.screens, ...copies] });
  return { project: next, firstScreen: copies[0]!, created: true };
}

/** Create one independent exact-target copy, or return the existing variant idempotently. */
export function ensureStoreTargetVariant(
  project: ProjectModel,
  sourceScreenId: string,
  target: StoreTargetDimensions,
): StoreTargetVariantResult {
  const source = project.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);
  const rootId = source.variantOf ?? source.id;
  const root = project.screens.find((screen) => screen.id === rootId);
  if (!root || root.variantOf !== undefined) throw new Error(`Invalid root screen "${rootId}"`);

  const existing = project.screens.find((screen) =>
    screen.variantOf === root.id && screen.storeTargetId === target.id,
  );
  if (existing) return { project, variant: existing, created: false };

  const copy = cloneScreenWithFreshIds(root);
  const variant = ScreenSchema.parse({
    ...copy,
    name: root.name,
    variantOf: root.id,
    storeTargetId: target.id,
    artboard: { width: target.width, height: target.height },
    elements: fitElementsToArtboard(copy.elements, root.artboard, target),
  });
  const next = recomputeManifests({
    ...project,
    screens: [...project.screens, variant],
  });
  return { project: next, variant, created: true };
}

export function removeStoreTargetVariant(
  project: ProjectModel,
  rootScreenId: string,
  storeTargetId: string,
): ProjectModel {
  const variant = project.screens.find((screen) =>
    screen.variantOf === rootScreenId && screen.storeTargetId === storeTargetId,
  );
  if (!variant) throw new Error(`Store target variant "${storeTargetId}" does not exist`);
  return removeScreenFromProject(project, variant.id);
}
