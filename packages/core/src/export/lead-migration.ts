// SPDX-License-Identifier: Apache-2.0
import {
  Screen as ScreenSchema,
  alignSynchronizedScreenSets,
  cloneScreenWithFreshIds,
  deriveAuthoringArtboard,
  fitElementsToArtboard,
  getLayout,
  isPrimaryScreen,
  replaceLayout,
  sameOutputFamily,
  screenSetModeFor,
  type Project,
  type Screen,
} from "@screenshot-studio/core/model";
import { artboardTargetStatus } from "./artboard-status.js";
import { findStoreTarget, leadStoreSizeId, type StoreSize, type StoreSpecs } from "./specs.js";

export interface LeadMigrationFamily {
  layoutId: string;
  locale: string;
  screens: number;
}

export interface LeadMigrationResult {
  project: Project;
  migrated: LeadMigrationFamily[];
}

function fits(screen: Screen, target: StoreSize): boolean {
  return artboardTargetStatus(screen.artboard, target).kind !== "invalid";
}

function ids(screens: readonly Screen[]): string {
  return screens.map(({ id }) => `"${id}"`).join(", ");
}

function migrateFamily(
  project: Project,
  layoutId: string,
  family: Screen,
  previous: StoreSize,
  current: StoreSize,
): { project: Project; screens: number } | null {
  const layout = getLayout(project, layoutId);
  const members = layout.screens.filter((screen) => sameOutputFamily(screen, family));
  const roots = members.filter(isPrimaryScreen);
  if (roots.every((root) => fits(root, current))) return null;

  const label = `${family.platform}/${family.device} ${family.locale} in layout "${layout.name}"`;
  const unfit = roots.filter((root) => fits(root, current) || !fits(root, previous));
  if (unfit.length > 0) {
    throw new Error(`Cannot migrate ${label}: primary screens ${ids(unfit)} do not match the previous lead "${previous.id}"`);
  }
  const leadRow = members.filter(({ storeTargetId }) => storeTargetId === current.id);
  const conflicts = members.filter((screen) => screen.storeTargetId === previous.id)
    .concat(leadRow.filter((screen) => screen.variantOf === undefined || !fits(screen, current)));
  if (conflicts.length > 0) {
    throw new Error(
      `Cannot migrate ${label}: screens ${ids(conflicts)} already use "${previous.id}", are standalone `
      + `"${current.id}" screens, or do not fit "${current.id}"; pair, fix, or remove them first`,
    );
  }

  // Screen ids stay put, so roots keep their slot identity and other variants keep their pairing;
  // only the authored content moves between the root and its previous-lead counterpart.
  const leadArtboard = leadRow[0]?.artboard ?? deriveAuthoringArtboard(family, current);
  const replaced = new Map<string, Screen>();
  const added: Screen[] = [];
  for (const root of roots) {
    const variant = leadRow.find(({ variantOf }) => variantOf === root.id);
    if (variant) {
      const { artboard, background, elements } = variant;
      replaced.set(root.id, ScreenSchema.parse({ ...root, artboard, background, elements }));
      replaced.set(variant.id, ScreenSchema.parse({
        ...variant,
        storeTargetId: previous.id,
        artboard: root.artboard,
        background: root.background,
        elements: root.elements,
      }));
      continue;
    }
    replaced.set(root.id, ScreenSchema.parse({
      ...root,
      artboard: leadArtboard,
      elements: fitElementsToArtboard(root.elements, root.artboard, leadArtboard),
    }));
    added.push(ScreenSchema.parse({
      ...cloneScreenWithFreshIds(root),
      name: root.name,
      variantOf: root.id,
      storeTargetId: previous.id,
    }));
  }
  const screens = [...layout.screens.map((screen) => replaced.get(screen.id) ?? screen), ...added];
  return {
    project: replaceLayout(project, {
      ...layout,
      screens: screenSetModeFor(layout, family) === "synchronized"
        ? alignSynchronizedScreenSets(screens, family)
        : screens,
    }),
    screens: roots.length,
  };
}

/**
 * Explicitly move primary screens authored at a family's previous lead target onto the current
 * catalog lead. Roots persist no target, so a lead change otherwise reinterprets them at an
 * incompatible aspect ratio. A root takes over its current-lead variant's content, or is fitted
 * by the same path as "Add output size" when it has none; its original content is kept unchanged
 * as the previous-lead variant. Families already compatible with the current lead are untouched.
 */
export function migrateLeadTarget(
  project: Project,
  specs: StoreSpecs,
  platform: string,
  device: string,
  previousLeadId: string,
): LeadMigrationResult {
  const current = findStoreTarget(specs, platform, device, leadStoreSizeId(specs, platform, device));
  const previous = findStoreTarget(specs, platform, device, previousLeadId);
  if (previous.id === current.id) {
    throw new Error(`"${previous.id}" is already the ${platform}/${device} lead target`);
  }

  let next = project;
  const migrated: LeadMigrationFamily[] = [];
  for (const { id: layoutId } of project.layouts) {
    const families = new Map<string, Screen>();
    for (const screen of getLayout(project, layoutId).screens) {
      if (screen.platform === platform && screen.device === device && isPrimaryScreen(screen)
        && !families.has(screen.locale)) families.set(screen.locale, screen);
    }
    for (const family of families.values()) {
      const result = migrateFamily(next, layoutId, family, previous, current);
      if (!result) continue;
      next = result.project;
      migrated.push({ layoutId, locale: family.locale, screens: result.screens });
    }
  }
  return { project: next, migrated };
}
