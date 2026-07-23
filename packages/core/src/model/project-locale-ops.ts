// SPDX-License-Identifier: Apache-2.0
import {
  Screen as ScreenSchema,
  type LayoutDirection,
  type Project as ProjectModel,
  type Screen,
} from "./schema.js";
import { mirrorElement } from "./element-tree.js";
import { cloneScreenWithFreshIds } from "./project-screen-ops.js";
import { getLayout, layoutLocales, replaceLayout } from "./project-layout.js";

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
