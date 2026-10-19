// SPDX-License-Identifier: Apache-2.0
import {
  Screen as ScreenSchema,
  type DesignLayout,
  type LayoutDirection,
  type Project as ProjectModel,
  type ScreenSetMode,
  type Screen,
} from "./schema.js";
import { mirrorElement } from "./element-tree.js";
import { cloneScreenWithFreshIds } from "./project-screen-ops.js";
import { getLayout, layoutLocales, replaceLayout } from "./project-layout.js";
import { fitElementsToArtboard } from "./project-artboard-ops.js";
import {
  alignSynchronizedScreenSets,
  isPrimaryScreen,
  sameOutputFamily,
  screenSetModeFor,
} from "./screen-set-policy.js";

/** Clone every screen in one locale as an independent target set, preserving source order. */
export function cloneLocaleSet(
  project: ProjectModel,
  layoutId: string,
  sourceLocale: string,
  targetLocale: string,
  targetDirection?: LayoutDirection,
): ProjectModel {
  if (!targetLocale.trim()) throw new Error("Target locale must not be empty");

  const layout = getLayout(project, layoutId);
  const sourceScreens = layout.screens.filter((screen) => screen.locale === sourceLocale);
  if (sourceScreens.length === 0) throw new Error(`Unknown source locale "${sourceLocale}"`);
  if (layoutLocales(layout).includes(targetLocale)) {
    throw new Error(`Locale "${targetLocale}" already exists`);
  }

  const direction = targetDirection ?? sourceScreens[0]!.direction ?? "ltr";
  const rootIdMap = new Map<string, string>();
  const copies = sourceScreens.map((source) => {
    const copy = cloneScreenWithFreshIds(source);
    if (source.storeTargetId === undefined) rootIdMap.set(source.id, copy.id);
    return copy;
  }).map((copy, index) => {
    const source = sourceScreens[index]!;
    const variantOf = source.variantOf ? rootIdMap.get(source.variantOf) : undefined;
    if (source.variantOf && !variantOf) throw new Error(`Missing cloned root "${source.variantOf}"`);
    const localized = ScreenSchema.parse({ ...copy, name: source.name, locale: targetLocale });
    return setScreenDirection(
      ScreenSchema.parse({ ...localized, ...(variantOf ? { variantOf } : {}) }),
      direction,
    );
  });

  const clonedPolicies = (layout.screenSetPolicies ?? [])
    .filter((policy) => policy.locale === sourceLocale)
    .map((policy) => ({ ...policy, locale: targetLocale }));
  return replaceLayout(project, {
    ...layout,
    ...(clonedPolicies.length > 0
      ? { screenSetPolicies: [...(layout.screenSetPolicies ?? []), ...clonedPolicies] }
      : {}),
    screens: [...layout.screens, ...copies],
  });
}

/** Remove an entire locale set without deleting any shared project assets. */
export function removeLocaleSet(
  project: ProjectModel,
  layoutId: string,
  locale: string,
): ProjectModel {
  const layout = getLayout(project, layoutId);
  const locales = layoutLocales(layout);
  if (!locales.includes(locale)) throw new Error(`Unknown locale "${locale}"`);
  if (locales.length === 1) throw new Error("Cannot remove the last locale");

  return replaceLayout(project, {
    ...layout,
    screenSetPolicies: layout.screenSetPolicies?.filter((policy) => policy.locale !== locale),
    screens: layout.screens.filter((screen) => screen.locale !== locale),
  });
}

function sameSizeRow(left: Screen, right: Screen): boolean {
  return left.platform === right.platform
    && left.device === right.device
    && left.storeTargetId === right.storeTargetId;
}

/** A family the target locale does not have yet adopts the source family's policy when copied. */
function targetScreenSetMode(layout: DesignLayout, source: Screen, targetLocale: string): ScreenSetMode {
  const family = { platform: source.platform, device: source.device, locale: targetLocale };
  return layout.screens.some((screen) => sameOutputFamily(screen, family))
    ? screenSetModeFor(layout, family)
    : screenSetModeFor(layout, source);
}

function sizeRowKey(screen: Screen): string {
  return [screen.platform, screen.device, screen.storeTargetId ?? ""].join("\u0000");
}

export interface MissingLocaleScreen {
  /** Locale that lacks the screen. */
  locale: string;
  /** The layout's first locale, which every other locale is compared with. */
  sourceLocale: string;
  sourceScreenId: string;
  /** Copying the screen fills every size of a synchronized slot rather than one size. */
  allSizes: boolean;
}

/**
 * Screens of the layout's first locale that another locale lacks. Locales keep no persisted link
 * between their screens, so a locale lacks screens only where one of its size rows is shorter than
 * the first locale's row; locales may name their screens differently. Within a short row, screens
 * whose name has no counterpart are the missing ones (locale copies keep names), and when names
 * were changed the trailing unmatched screens are reported. A synchronized target family is
 * compared by slot (primary screens) only, because its exact sizes mirror the slots.
 */
export function missingLocaleScreens(layout: DesignLayout): MissingLocaleScreen[] {
  const [sourceLocale, ...locales] = layoutLocales(layout);
  if (!sourceLocale) return [];
  const sourceRows = new Map<string, Screen[]>();
  for (const screen of layout.screens) {
    if (screen.locale !== sourceLocale) continue;
    sourceRows.set(sizeRowKey(screen), [...(sourceRows.get(sizeRowKey(screen)) ?? []), screen]);
  }
  const order = new Map(layout.screens.map((screen, index) => [screen.id, index]));
  return locales.flatMap((locale) => Array.from(sourceRows.values())
    .flatMap((sourceRow): Screen[] => {
      const first = sourceRow[0]!;
      if (!isPrimaryScreen(first) && targetScreenSetMode(layout, first, locale) === "synchronized") return [];
      const targetRow = layout.screens.filter((screen) => screen.locale === locale && sameSizeRow(screen, first));
      const shortfall = sourceRow.length - targetRow.length;
      if (shortfall <= 0) return [];
      const names = targetRow.map((screen) => screen.name);
      const unmatched = sourceRow.filter((screen) => {
        const index = names.indexOf(screen.name);
        if (index >= 0) names.splice(index, 1);
        return index < 0;
      });
      return unmatched.slice(-shortfall);
    })
    .sort((left, right) => order.get(left.id)! - order.get(right.id)!)
    .map((screen) => {
      const allSizes = targetScreenSetMode(layout, screen, locale) === "synchronized"
        && Array.from(sourceRows.values()).some((row) =>
          sameOutputFamily(row[0]!, screen) && !isPrimaryScreen(row[0]!)
        );
      return { locale, sourceLocale, sourceScreenId: screen.id, allSizes };
    }));
}

/**
 * Where a copy of `source` lands among `screens`: after the target-locale screen matching the
 * nearest earlier source screen of the same size row by name, else at the source's position in
 * that row, else after the locale's family, else after the locale's last screen.
 */
function localeInsertIndex(screens: readonly Screen[], source: Screen, targetLocale: string): number {
  const sourceRow = screens.filter((screen) => screen.locale === source.locale && sameSizeRow(screen, source));
  const targetRow = screens.filter((screen) => screen.locale === targetLocale && sameSizeRow(screen, source));
  const sourceIndex = sourceRow.indexOf(source);
  for (let index = sourceIndex - 1; index >= 0; index -= 1) {
    const anchor = targetRow.find((screen) => screen.name === sourceRow[index]!.name);
    if (anchor) return screens.indexOf(anchor) + 1;
  }
  if (targetRow.length > 0) {
    return sourceIndex < targetRow.length
      ? screens.indexOf(targetRow[sourceIndex]!)
      : screens.indexOf(targetRow[targetRow.length - 1]!) + 1;
  }
  const family = { platform: source.platform, device: source.device, locale: targetLocale };
  const familyLast = screens.map((screen) => sameOutputFamily(screen, family)).lastIndexOf(true);
  if (familyLast >= 0) return familyLast + 1;
  return screens.map((screen) => screen.locale === targetLocale).lastIndexOf(true) + 1;
}

function localizedCopy(
  screen: Screen,
  locale: string,
  direction: LayoutDirection,
  variantOf?: string,
): Screen {
  const copy = cloneScreenWithFreshIds(screen);
  copy.name = screen.name;
  copy.locale = locale;
  if (variantOf) copy.variantOf = variantOf;
  else delete copy.variantOf;
  return setScreenDirection(ScreenSchema.parse(copy), direction);
}

export interface CopyScreenToLocaleResult {
  project: ProjectModel;
  createdScreenId: string;
}

/**
 * Copy one screen into another existing locale of the same layout under its source name, baking
 * that locale's text direction. A synchronized target family receives the whole slot in every size
 * it has; an independent one receives only this screen, paired with the same-named slot when free.
 */
export function copyScreenToLocale(
  project: ProjectModel,
  layoutId: string,
  sourceScreenId: string,
  targetLocale: string,
): CopyScreenToLocaleResult {
  const layout = getLayout(project, layoutId);
  const source = layout.screens.find((screen) => screen.id === sourceScreenId);
  if (!source) throw new Error(`Unknown screen "${sourceScreenId}"`);
  if (source.locale === targetLocale) {
    throw new Error(`Screen "${source.name}" is already in locale "${targetLocale}"`);
  }
  const localeScreens = layout.screens.filter((screen) => screen.locale === targetLocale);
  if (localeScreens.length === 0) throw new Error(`Unknown locale "${targetLocale}"`);

  const direction = localeScreens[0]!.direction;
  const family = { platform: source.platform, device: source.device, locale: targetLocale };
  const familyScreens = localeScreens.filter((screen) => sameOutputFamily(screen, family));
  const sourcePolicy = familyScreens.length === 0
    ? layout.screenSetPolicies?.find((policy) =>
      policy.platform === source.platform
      && policy.device === source.device
      && policy.locale === source.locale
    )
    : undefined;
  const nextLayout: DesignLayout = sourcePolicy
    ? { ...layout, screenSetPolicies: [...(layout.screenSetPolicies ?? []), { ...sourcePolicy, locale: targetLocale }] }
    : layout;
  const screens = [...layout.screens];

  if (targetScreenSetMode(layout, source, targetLocale) === "synchronized") {
    if (!isPrimaryScreen(source)) throw new Error("Copy the primary screen of a synchronized slot");
    const sizeRows = familyScreens.length > 0
      ? familyScreens
      : layout.screens.filter((screen) => sameOutputFamily(screen, source));
    const targets = new Map(sizeRows
      .filter((screen) => screen.storeTargetId !== undefined)
      .map((screen) => [screen.storeTargetId!, screen.artboard]));
    const root = localizedCopy(source, targetLocale, direction);
    const variants = Array.from(targets, ([storeTargetId, artboard]) => {
      const sourceVariant = layout.screens.find((screen) =>
        screen.variantOf === source.id && screen.storeTargetId === storeTargetId
      );
      const variantSource: Screen = sourceVariant ?? {
        ...source,
        storeTargetId,
        artboard: { ...artboard },
        elements: fitElementsToArtboard(source.elements, source.artboard, artboard),
      };
      return localizedCopy(variantSource, targetLocale, direction, root.id);
    });
    screens.splice(localeInsertIndex(screens, source, targetLocale), 0, root);
    return {
      project: replaceLayout(project, {
        ...nextLayout,
        screens: alignSynchronizedScreenSets([...screens, ...variants], family),
      }),
      createdScreenId: root.id,
    };
  }

  const sourceRoot = source.variantOf
    ? layout.screens.find((screen) => screen.id === source.variantOf)
    : undefined;
  const pairedRoot = sourceRoot
    ? familyScreens.find((screen) =>
      isPrimaryScreen(screen)
      && screen.name === sourceRoot.name
      && !familyScreens.some((other) =>
        other.variantOf === screen.id && other.storeTargetId === source.storeTargetId
      )
    )
    : undefined;
  const copy = localizedCopy(source, targetLocale, direction, pairedRoot?.id);
  screens.splice(localeInsertIndex(screens, source, targetLocale), 0, copy);
  return {
    project: replaceLayout(project, { ...nextLayout, screens }),
    createdScreenId: copy.id,
  };
}

/** Materialize a screen's opposite horizontal placement without reflecting media pixels. */
export function setScreenDirection(screen: Screen, direction: LayoutDirection): Screen {
  const currentDirection = screen.direction ?? "ltr";
  if (currentDirection === direction) return ScreenSchema.parse(screen);

  const elements = screen.elements.map((element) => mirrorElement(element, screen.artboard.width));

  return ScreenSchema.parse({ ...screen, direction, elements });
}

/** Change every screen in a locale together so the locale set keeps one direction. */
export function setLocaleDirection(
  project: ProjectModel,
  layoutId: string,
  locale: string,
  direction: LayoutDirection,
): ProjectModel {
  const layout = getLayout(project, layoutId);
  if (!layoutLocales(layout).includes(locale)) throw new Error(`Unknown locale "${locale}"`);
  if (layout.screens
    .filter((screen) => screen.locale === locale)
    .every((screen) => screen.direction === direction)) return project;

  const screens = layout.screens.map((screen) =>
    screen.locale === locale ? setScreenDirection(screen, direction) : screen,
  );
  return replaceLayout(project, { ...layout, screens });
}
