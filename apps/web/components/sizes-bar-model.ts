// SPDX-License-Identifier: Apache-2.0
import {
  isPrimaryScreen,
  screenSetModeFor,
  slotScreens,
  type DesignLayout,
  type Screen,
} from "@screenshot-studio/core/model";
import {
  destinationLabel,
  findStoreTarget,
  leadStoreSizeId,
  listOutputFamilies,
  listStoreTargets,
  type StoreSize,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import {
  conciseStoreTargetLabel,
  outputFamilyEditorLabel,
  screenStoreTarget,
  storeTargetDeviceCopy,
} from "@web/lib/editor/editor-workspace";

export type SizeRemoval =
  | { kind: "size"; rootScreenId: string; targetId: string; label: string; synchronized: boolean }
  | { kind: "family"; sourceScreenId: string; label: string };

export interface SizeChip {
  key: string;
  role: "master" | "variant";
  label: string;
  /** Omitted when the label already names the pixels. */
  pixels: string | null;
  devices: string | null;
  screenId: string;
  current: boolean;
  removal: SizeRemoval | null;
}

export interface SizeGroup {
  key: string;
  label: string;
  chips: SizeChip[];
}

export type AddSizeAction =
  | { kind: "size"; target: StoreSize; openScreenId: string | null }
  | { kind: "family"; platform: string; device: string; leadTarget: StoreSize };

export interface AddSizeOption {
  value: string;
  label: string;
  description?: string;
  group: string;
  action: AddSizeAction;
}

export interface SizesBarModel {
  groups: SizeGroup[];
  current: SizeChip | null;
  addOptions: AddSizeOption[];
}

export const NEW_DESTINATION_GROUP = "New destination";

function tryOrNull<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

function familyLabel(platform: string, device: string, specs: StoreSpecs): string {
  return `${destinationLabel(platform, specs)} · ${outputFamilyEditorLabel(platform, device, specs)}`;
}

/**
 * Every exact size of the active locale, grouped by output family in layout order with the master
 * first, so in isolated layouts chips read left to right in the order `[` and `]` step through
 * Overview rows. A chip
 * opens the active slot's screen when its size holds one, else the size's first screen.
 */
export function sizesBarModel(layout: DesignLayout, screen: Screen, specs: StoreSpecs): SizesBarModel {
  const slot = new Set(slotScreens(layout, screen).map(({ id }) => id));
  const pick = (screens: Screen[]): Screen => screens.find(({ id }) => slot.has(id)) ?? screens[0]!;
  const families = new Map<string, Screen[]>();
  for (const candidate of layout.screens) {
    if (candidate.locale !== screen.locale) continue;
    const key = `${candidate.platform}/${candidate.device}`;
    families.set(key, [...(families.get(key) ?? []), candidate]);
  }
  const familiesWithMaster = new Set(
    [...families].filter(([, screens]) => screens.some(isPrimaryScreen)).map(([key]) => key),
  );
  const currentKey = `${screen.platform}/${screen.device}`;

  const groups: SizeGroup[] = [];
  const addOptions: AddSizeOption[] = [];
  for (const [key, familyScreens] of families) {
    const { platform, device } = familyScreens[0]!;
    const label = familyLabel(platform, device, specs);
    const masters = familyScreens.filter(isPrimaryScreen);
    const variants = new Map<string, Screen[]>();
    for (const candidate of familyScreens) {
      if (candidate.storeTargetId === undefined) continue;
      variants.set(candidate.storeTargetId, [...(variants.get(candidate.storeTargetId) ?? []), candidate]);
    }
    const synchronized = masters.length > 0 && screenSetModeFor(layout, pick(masters)) === "synchronized";
    const chip = (
      chipKey: string,
      role: SizeChip["role"],
      target: StoreSize | null,
      screens: Screen[],
      removal: (opened: Screen, chipLabel: string) => SizeRemoval | null,
    ): SizeChip => {
      const opened = pick(screens);
      // Portrait is the default, so only other orientations are named, as in the device copy.
      const chipLabel = target
        ? conciseStoreTargetLabel(target, platform, device, specs).replace(/ · Portrait\b/, "")
        : opened.storeTargetId ?? label;
      const pixels = target ? `${target.width}×${target.height}` : null;
      return {
        key: chipKey,
        role,
        label: chipLabel,
        pixels: pixels && !chipLabel.includes(pixels) ? pixels : null,
        devices: target?.devices?.join(", ") ?? null,
        screenId: opened.id,
        current: screens.some(({ id }) => id === screen.id),
        removal: removal(opened, chipLabel),
      };
    };

    const chips: SizeChip[] = [];
    if (masters.length > 0) {
      chips.push(chip(`${key}/master`, "master", screenStoreTarget(masters[0]!, specs), masters, () => (
        familiesWithMaster.size > 1 ? { kind: "family", sourceScreenId: masters[0]!.id, label } : null
      )));
    }
    for (const [targetId, screens] of variants) {
      const target = tryOrNull(() => findStoreTarget(specs, platform, device, targetId));
      chips.push(chip(`${key}/${targetId}`, "variant", target, screens, (opened, chipLabel) => (
        masters.length > 0
          ? { kind: "size", rootScreenId: opened.variantOf ?? opened.id, targetId, label: chipLabel, synchronized }
          : null
      )));
    }
    groups.push({ key, label, chips });

    if (masters.length === 0) continue;
    const leadId = tryOrNull(() => leadStoreSizeId(specs, platform, device));
    for (const target of tryOrNull(() => listStoreTargets(specs, platform, device)) ?? []) {
      if (target.id === leadId || variants.has(target.id)) continue;
      const { title, detail } = storeTargetDeviceCopy(target, platform, device, specs);
      addOptions.push({
        value: `${key}|${target.id}`,
        label: title,
        description: detail,
        group: label,
        action: { kind: "size", target, openScreenId: key === currentKey ? null : pick(masters).id },
      });
    }
  }

  if (familiesWithMaster.has(currentKey)) {
    for (const family of listOutputFamilies(specs)) {
      if (!family.creatable || familiesWithMaster.has(family.key)) continue;
      const sizes = tryOrNull(() => listStoreTargets(specs, family.platform, family.device)) ?? [];
      const leadTarget = sizes.find(({ id }) => id === family.leadStoreSizeId) ?? sizes[0];
      if (!leadTarget) continue;
      addOptions.push({
        value: `new|${family.key}`,
        label: familyLabel(family.platform, family.device, specs),
        group: NEW_DESTINATION_GROUP,
        action: { kind: "family", platform: family.platform, device: family.device, leadTarget },
      });
    }
  }

  return {
    groups,
    current: groups.flatMap(({ chips }) => chips).find(({ current }) => current) ?? null,
    addOptions,
  };
}
