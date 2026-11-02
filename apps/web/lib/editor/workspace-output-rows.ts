// SPDX-License-Identifier: Apache-2.0
import {
  sameScreenGroup,
  slotScreens,
  type DesignLayout,
  type Screen,
} from "@screenshot-studio/core/model";
import { DEFAULT_STORE_SPECS, type StoreSpecs } from "@screenshot-studio/core/export";
import { conciseStoreTargetLabel, screenStoreTarget, storeOutputLabel } from "./store-target-labels";

export interface OutputFamily {
  key: string;
  label: string;
  screens: Screen[];
}

export interface WorkspaceOutputFamily extends OutputFamily {
  editing: boolean;
}

function outputFamilyKey(screen: Pick<Screen, "platform" | "device">): string {
  return `${screen.platform}/${screen.device}`;
}

function overviewRowLabel(familyLabel: string, screen: Screen, specs: StoreSpecs): string {
  const target = screen.storeTargetId === undefined ? null : screenStoreTarget(screen, specs);
  return target
    ? `${familyLabel} · ${conciseStoreTargetLabel(target, screen.platform, screen.device, specs)}`
    : familyLabel;
}

/** Preserve project order while separating independent output families into canvas rows. */
export function groupScreensByOutput(
  screens: readonly Screen[],
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): OutputFamily[] {
  const rows: OutputFamily[] = [];
  const byKey = new Map<string, OutputFamily>();
  for (const screen of screens) {
    const key = `${screen.platform}/${screen.device}`;
    let row = byKey.get(key);
    if (!row) {
      row = { key, label: storeOutputLabel(screen.platform, screen.device, specs), screens: [] };
      byKey.set(key, row);
      rows.push(row);
    }
    row.screens.push(screen);
  }
  return rows;
}

/** Exact screens that may be selected, reordered, authored, or transformed together. */
export function workspaceEditingScope(layout: DesignLayout, activeScreen: Screen): Screen[] {
  if (layout.mode === "connected") {
    return layout.screens.filter((screen) => sameScreenGroup(screen, activeScreen));
  }
  return layout.screens.filter((screen) => {
    if (activeScreen.storeTargetId === undefined) {
      return screen.locale === activeScreen.locale && screen.storeTargetId === undefined;
    }
    return screen.platform === activeScreen.platform
      && screen.device === activeScreen.device
      && screen.locale === activeScreen.locale
      && screen.storeTargetId === activeScreen.storeTargetId;
  });
}

/** Every independent output row visible in Overview for the active locale. */
export function workspaceOverviewRows(
  layout: DesignLayout,
  activeScreen: Screen,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): WorkspaceOutputFamily[] {
  const families = new Map<string, Screen[]>();
  for (const screen of layout.screens) {
    if (screen.locale !== activeScreen.locale) continue;
    const key = outputFamilyKey(screen);
    const screens = families.get(key) ?? [];
    screens.push(screen);
    families.set(key, screens);
  }

  if (layout.mode === "isolated") {
    return Array.from(families).flatMap(([key, familyScreens]) => {
      const roots = familyScreens.filter((screen) => screen.storeTargetId === undefined);
      const variantsByTarget = new Map<string, Screen[]>();
      for (const screen of familyScreens) {
        if (screen.storeTargetId === undefined) continue;
        const variants = variantsByTarget.get(screen.storeTargetId) ?? [];
        variants.push(screen);
        variantsByTarget.set(screen.storeTargetId, variants);
      }

      const rows: Array<{ targetId: string | undefined; screens: Screen[] }> = roots.length > 0
        ? [{ targetId: undefined, screens: roots }]
        : [];
      rows.push(...Array.from(variantsByTarget, ([targetId, screens]) => ({ targetId, screens })));
      const familyLabel = storeOutputLabel(familyScreens[0]!.platform, familyScreens[0]!.device, specs);

      return rows.map(({ targetId, screens }) => ({
        key: targetId === undefined ? key : `${key}/${targetId}`,
        label: overviewRowLabel(familyLabel, screens[0]!, specs),
        screens,
        editing: screens.some((screen) => screen.id === activeScreen.id),
      }));
    });
  }

  const activeKey = outputFamilyKey(activeScreen);
  return Array.from(families, ([key, familyScreens]) => {
    const editing = key === activeKey;
    const roots = familyScreens.filter((screen) => screen.storeTargetId === undefined);
    const anchor = editing ? activeScreen : roots[0] ?? familyScreens[0]!;
    const screens = editing || roots.length === 0
      ? layout.screens.filter((screen) => sameScreenGroup(screen, anchor))
      : roots;
    const familyLabel = storeOutputLabel(anchor.platform, anchor.device, specs);

    return {
      key,
      label: overviewRowLabel(familyLabel, screens[0] ?? anchor, specs),
      screens,
      editing,
    };
  });
}

/**
 * The screen `[` (-1) or `]` (+1) opens: the previous or next Overview size row, landing on the
 * active screen's slot when that row holds it, else on the row's first screen. The ends clamp.
 */
export function adjacentSizeScreenId(
  layout: DesignLayout,
  activeScreen: Screen,
  step: -1 | 1,
  specs: StoreSpecs = DEFAULT_STORE_SPECS,
): string | null {
  const rows = workspaceOverviewRows(layout, activeScreen, specs);
  const current = rows.findIndex((row) => row.editing);
  const next = current < 0 ? undefined : rows[current + step];
  if (!next) return null;
  const slot = new Set(slotScreens(layout, activeScreen).map((screen) => screen.id));
  return (next.screens.find((screen) => slot.has(screen.id)) ?? next.screens[0])?.id ?? null;
}
