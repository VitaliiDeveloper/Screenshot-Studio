// SPDX-License-Identifier: Apache-2.0
import {
  Screen as ScreenSchema,
  ScreenSetPolicy as ScreenSetPolicySchema,
  type Project as ProjectModel,
  type Screen,
  type ScreenSetMode,
} from "./schema.js";
import { getLayout, replaceLayout } from "./project-layout.js";
import {
  cloneScreenWithFreshIds,
  parseScreenPlacement,
} from "./project-screen-ops.js";
import {
  fitElementsToArtboard,
  resizeScreenArtboard,
} from "./project-artboard-ops.js";
import {
  alignSynchronizedScreenSets,
  isPrimaryScreen,
  sameOutputFamily,
  screenSetModeFor,
} from "./screen-set-policy.js";

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
export function deriveAuthoringArtboard(
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
 * Create one separate platform/device output set for the source locale. Every root screen in the
 * source family is copied with fresh ids and fitted to the destination master artboard; size
 * variants remain family-local and are deliberately not copied. New families explicitly default
 * to synchronized screen slots while existing families retain their persisted policy.
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
  const sourceRoot = source.variantOf
    ? layout.screens.find((screen) => screen.id === source.variantOf)
    : isPrimaryScreen(source)
      ? source
      : layout.screens.find((screen) => sameOutputFamily(screen, source) && isPrimaryScreen(screen));
  if (!sourceRoot || !isPrimaryScreen(sourceRoot)) {
    throw new Error(`No primary screen exists for "${source.id}"`);
  }

  const existing = layout.screens.find((screen) =>
    isPrimaryScreen(screen)
    && screen.platform === placement.platform
    && screen.device === placement.device
    && screen.locale === sourceRoot.locale,
  );
  if (existing) return { project, firstScreen: existing, created: false };

  const sourceRoots = layout.screens.filter((screen) =>
    isPrimaryScreen(screen)
    && screen.platform === sourceRoot.platform
    && screen.device === sourceRoot.device
    && screen.locale === sourceRoot.locale,
  );
  if (sourceRoots.length === 0) throw new Error(`No source output screens for "${sourceRoot.id}"`);

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
  const synchronized = setOutputFamilyScreenSetMode(
    next,
    layoutId,
    copies[0]!.id,
    "synchronized",
  );
  const firstScreen = getLayout(synchronized, layoutId).screens.find(({ id }) => id === copies[0]!.id)!;
  return { project: synchronized, firstScreen, created: true };
}

/**
 * Create an exact target. Independent families materialize one root variant; synchronized
 * families materialize that target for every logical screen slot in the family.
 */
export function ensureStoreTargetVariant(
  project: ProjectModel,
  layoutId: string,
  sourceScreenId: string,
  target: StoreTargetDimensions,
): StoreTargetVariantResult {
  const layout = getLayout(project, layoutId);
  const source = layout.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);
  const root = source.variantOf
    ? layout.screens.find((screen) => screen.id === source.variantOf)
    : isPrimaryScreen(source)
      ? source
      : layout.screens.find((screen) => sameOutputFamily(screen, source) && isPrimaryScreen(screen));
  if (!root || !isPrimaryScreen(root)) {
    throw new Error(`No primary screen exists for "${source.id}"`);
  }

  const existing = layout.screens.find((screen) =>
    screen.variantOf === root.id && screen.storeTargetId === target.id,
  );
  const synchronized = screenSetModeFor(layout, root) === "synchronized";
  if (existing && !synchronized) return { project, variant: existing, created: false };

  const targetSetScreen = layout.screens.find((screen) =>
    screen.platform === root.platform
    && screen.device === root.device
    && screen.locale === root.locale
    && screen.storeTargetId === target.id
  );
  const variantArtboard = targetSetScreen
    ? { ...targetSetScreen.artboard }
    : deriveAuthoringArtboard(root, target);
  const roots = synchronized
    ? layout.screens.filter((screen) => sameOutputFamily(screen, root) && isPrimaryScreen(screen))
    : [root];
  const additions = roots.flatMap((candidateRoot) => {
    if (layout.screens.some((screen) =>
      screen.variantOf === candidateRoot.id && screen.storeTargetId === target.id
    )) return [];
    const copy = cloneScreenWithFreshIds(candidateRoot);
    return [ScreenSchema.parse({
      ...copy,
      name: candidateRoot.name,
      variantOf: candidateRoot.id,
      storeTargetId: target.id,
      artboard: variantArtboard,
      elements: fitElementsToArtboard(copy.elements, candidateRoot.artboard, variantArtboard),
    })];
  });
  if (additions.length === 0) return { project, variant: existing!, created: false };

  const screens = synchronized
    ? alignSynchronizedScreenSets([...layout.screens, ...additions], root)
    : [...layout.screens, ...additions];
  const next = replaceLayout(project, { ...layout, screens });
  const variant = getLayout(next, layoutId).screens.find((screen) =>
    screen.variantOf === root.id && screen.storeTargetId === target.id
  )!;
  return { project: next, variant, created: existing === undefined };
}

export function removeStoreTargetVariant(
  project: ProjectModel,
  layoutId: string,
  rootScreenId: string,
  storeTargetId: string,
): ProjectModel {
  const layout = getLayout(project, layoutId);
  const variant = layout.screens.find((screen) => (
    (screen.variantOf === rootScreenId || screen.id === rootScreenId)
    && screen.storeTargetId === storeTargetId
  ));
  if (!variant) throw new Error(`Store target variant "${storeTargetId}" does not exist`);
  const screens = layout.screens.filter((screen) => !(
    sameOutputFamily(screen, variant) && screen.storeTargetId === storeTargetId
  ));
  return replaceLayout(project, { ...layout, screens });
}

/**
 * Remove one complete platform/device output family for a locale. At least one family must remain
 * for that locale so the editor never leaves a localized layout without an authoring target.
 */
export function removeStoreOutputFamily(
  project: ProjectModel,
  layoutId: string,
  sourceScreenId: string,
): ProjectModel {
  const layout = getLayout(project, layoutId);
  const source = layout.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);

  const familyKeys = new Set(layout.screens
    .filter((screen) => screen.locale === source.locale && isPrimaryScreen(screen))
    .map((screen) => `${screen.platform}/${screen.device}`));
  if (familyKeys.size <= 1) {
    throw new Error(`Cannot remove the last output family for locale "${source.locale}"`);
  }

  const screens = layout.screens.filter((screen) => !sameOutputFamily(screen, source));
  const screenSetPolicies = layout.screenSetPolicies?.filter((policy) => !(
    policy.platform === source.platform
    && policy.device === source.device
    && policy.locale === source.locale
  ));
  return replaceLayout(project, { ...layout, screens, screenSetPolicies });
}

/**
 * Persist one output-family screen-slot policy. Enabling synchronization reconciles every
 * existing exact target and the primary size by persisted slot order before committing the
 * strict policy. Existing content is preserved; missing counterparts are fitted clones.
 */
export function setOutputFamilyScreenSetMode(
  project: ProjectModel,
  layoutId: string,
  sourceScreenId: string,
  mode: ScreenSetMode,
): ProjectModel {
  const initialLayout = getLayout(project, layoutId);
  const source = initialLayout.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);

  if (screenSetModeFor(initialLayout, source) === mode
    && initialLayout.screenSetPolicies?.some((policy) =>
      policy.platform === source.platform
      && policy.device === source.device
      && policy.locale === source.locale
      && policy.mode === mode
    )) return project;

  let screens = [...initialLayout.screens];
  if (mode === "synchronized") {
    let roots = screens.filter((screen) => sameOutputFamily(screen, source) && isPrimaryScreen(screen));
    if (roots.length === 0) throw new Error("Cannot synchronize an output family without a primary size");
    const targetIds = Array.from(new Set(screens
      .filter((screen) => sameOutputFamily(screen, source) && screen.storeTargetId !== undefined)
      .map((screen) => screen.storeTargetId!)));
    const targetRows = new Map(targetIds.map((targetId) => [
      targetId,
      screens.filter((screen) => sameOutputFamily(screen, source) && screen.storeTargetId === targetId),
    ]));
    const slotCount = Math.max(roots.length, ...Array.from(targetRows.values(), (row) => row.length));

    const newRoots: Screen[] = [];
    for (let index = roots.length; index < slotCount; index += 1) {
      const counterpart = Array.from(targetRows.values()).find((row) => row[index])?.[index];
      if (!counterpart) throw new Error(`Cannot materialize synchronized slot ${index + 1}`);
      const copy = cloneScreenWithFreshIds(counterpart);
      newRoots.push(ScreenSchema.parse({
        ...copy,
        name: counterpart.name,
        variantOf: undefined,
        storeTargetId: undefined,
        artboard: { ...roots[0]!.artboard },
        elements: fitElementsToArtboard(counterpart.elements, counterpart.artboard, roots[0]!.artboard),
      }));
    }
    if (newRoots.length > 0) {
      const lastRootIndex = screens.reduce((last, screen, index) => (
        sameOutputFamily(screen, source) && isPrimaryScreen(screen) ? index : last
      ), -1);
      screens.splice(lastRootIndex + 1, 0, ...newRoots);
      roots = [...roots, ...newRoots];
    }

    const replacements = new Map<string, Screen>();
    const additions: Screen[] = [];
    for (const [targetId, row] of targetRows) {
      const targetArtboard = row[0]!.artboard;
      roots.forEach((root, index) => {
        const existing = row[index];
        if (existing) {
          replacements.set(existing.id, ScreenSchema.parse({ ...existing, variantOf: root.id }));
          return;
        }
        const copy = cloneScreenWithFreshIds(root);
        additions.push(ScreenSchema.parse({
          ...copy,
          name: root.name,
          variantOf: root.id,
          storeTargetId: targetId,
          artboard: { ...targetArtboard },
          elements: fitElementsToArtboard(root.elements, root.artboard, targetArtboard),
        }));
      });
    }
    screens = alignSynchronizedScreenSets([
      ...screens.map((screen) => replacements.get(screen.id) ?? screen),
      ...additions,
    ], source);
  }

  const policy = ScreenSetPolicySchema.parse({
    platform: source.platform,
    device: source.device,
    locale: source.locale,
    mode,
  });
  const screenSetPolicies = [
    ...(initialLayout.screenSetPolicies ?? []).filter((candidate) => !(
      candidate.platform === source.platform
      && candidate.device === source.device
      && candidate.locale === source.locale
    )),
    policy,
  ];
  return replaceLayout(project, { ...initialLayout, screens, screenSetPolicies });
}
