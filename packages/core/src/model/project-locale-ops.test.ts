// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { Project as ProjectSchema, type Project, type Screen, type ScreenSetPolicy } from "./schema.js";
import { createTextElement } from "./factories.js";
import { copyScreenToLocale, missingLocaleScreens } from "./project-locale-ops.js";

const IPHONE = { width: 1320, height: 2868 };
const IPHONE_65 = { width: 1284, height: 2778 };

function screen(id: string, name: string, locale: string, extra: Partial<Screen> = {}): Screen {
  return {
    id,
    name,
    platform: "apple",
    device: "iphone",
    locale,
    direction: "ltr",
    artboard: IPHONE,
    background: { type: "solid", color: "#101827" },
    elements: [],
    ...extra,
  } as Screen;
}

function variant(id: string, name: string, locale: string, root: string): Screen {
  return screen(id, name, locale, { variantOf: root, storeTargetId: "6.5", artboard: IPHONE_65 });
}

function project(screens: Screen[], screenSetPolicies?: ScreenSetPolicy[]): Project {
  return ProjectSchema.parse({
    meta: { name: "T", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Default",
      mode: "isolated",
      screens,
      ...(screenSetPolicies ? { screenSetPolicies } : {}),
    }],
  });
}

function synced(locale: string): ScreenSetPolicy {
  return { platform: "apple", device: "iphone", locale, mode: "synchronized" };
}

const layoutOf = (value: Project) => value.layouts[0]!;
const localeNames = (value: Project, locale: string) => layoutOf(value).screens
  .filter((candidate) => candidate.locale === locale)
  .map((candidate) => `${candidate.name}${candidate.storeTargetId ? `@${candidate.storeTargetId}` : ""}`);

describe("missing locale screens", () => {
  it("reports source screens another locale lacks and copies one back into place", () => {
    const source = project([
      screen("hero", "Hero", "en"),
      screen("details", "Details", "en"),
      screen("pricing", "Pricing", "en"),
      screen("hero-de", "Hero", "de"),
      screen("pricing-de", "Pricing", "de"),
    ]);

    expect(missingLocaleScreens(layoutOf(source))).toEqual([
      { locale: "de", sourceLocale: "en", sourceScreenId: "details", allSizes: false },
    ]);

    const { project: next, createdScreenId } = copyScreenToLocale(source, "default", "details", "de");
    const created = layoutOf(next).screens.find((candidate) => candidate.id === createdScreenId)!;
    expect(created).toMatchObject({ name: "Details", locale: "de" });
    expect(createdScreenId).not.toBe("details");
    expect(localeNames(next, "de")).toEqual(["Hero", "Details", "Pricing"]);
    expect(missingLocaleScreens(layoutOf(next))).toEqual([]);
    expect(localeNames(source, "de")).toEqual(["Hero", "Pricing"]);
  });

  it("matches repeated names as a multiset", () => {
    const source = project([
      screen("a1", "Untitled", "en"),
      screen("a2", "Untitled", "en"),
      screen("a1-de", "Untitled", "de"),
    ]);

    expect(missingLocaleScreens(layoutOf(source)).map((entry) => entry.sourceScreenId)).toEqual(["a2"]);
  });

  it("accepts locale-specific names when each size row is complete", () => {
    const source = project([
      screen("hero", "Hero", "en"),
      screen("details", "Details", "en"),
      screen("hero-ar", "البطل", "ar", { direction: "rtl" }),
      screen("details-ar", "التفاصيل", "ar", { direction: "rtl" }),
    ]);

    expect(missingLocaleScreens(layoutOf(source))).toEqual([]);
  });

  it("reports the trailing screens of a short row when names differ, and appends the copy", () => {
    const source = project([
      screen("hero", "Hero", "en"),
      screen("details", "Details", "en"),
      screen("pricing", "Pricing", "en"),
      screen("hero-de", "Start", "de"),
      screen("details-de", "Einzelheiten", "de"),
    ]);

    expect(missingLocaleScreens(layoutOf(source)).map((entry) => entry.sourceScreenId)).toEqual(["pricing"]);
    const { project: next } = copyScreenToLocale(source, "default", "pricing", "de");
    expect(localeNames(next, "de")).toEqual(["Start", "Einzelheiten", "Pricing"]);
  });

  it("bakes the target locale direction into the copy", () => {
    const text = { ...createTextElement({ x: 100 }), id: "title", width: 200 };
    const source = project([
      screen("intro", "Intro", "en"),
      screen("hero", "Hero", "en", { elements: [text] }),
      screen("intro-ar", "Intro", "ar", { direction: "rtl" }),
    ]);

    const { project: next, createdScreenId } = copyScreenToLocale(source, "default", "hero", "ar");
    const created = layoutOf(next).screens.find((candidate) => candidate.id === createdScreenId)!;
    expect(created.direction).toBe("rtl");
    expect(created.elements[0]).toMatchObject({ x: IPHONE.width - 100 - 200, align: "right" });
    expect(created.elements[0]!.id).not.toBe("title");
  });

  it("treats a synchronized slot as one issue and fills every size of the target family", () => {
    const source = project([
      screen("hero", "Hero", "en"),
      screen("details", "Details", "en"),
      variant("hero-65", "Hero", "en", "hero"),
      variant("details-65", "Details", "en", "details"),
      screen("hero-de", "Hero", "de"),
      variant("hero-de-65", "Hero", "de", "hero-de"),
    ], [synced("en"), synced("de")]);

    expect(missingLocaleScreens(layoutOf(source))).toEqual([
      { locale: "de", sourceLocale: "en", sourceScreenId: "details", allSizes: true },
    ]);

    const { project: next, createdScreenId } = copyScreenToLocale(source, "default", "details", "de");
    expect(localeNames(next, "de")).toEqual(["Hero", "Details", "Hero@6.5", "Details@6.5"]);
    const copiedVariant = layoutOf(next).screens.find((candidate) =>
      candidate.locale === "de" && candidate.storeTargetId === "6.5" && candidate.name === "Details"
    )!;
    expect(copiedVariant).toMatchObject({ variantOf: createdScreenId, artboard: IPHONE_65 });
    expect(missingLocaleScreens(layoutOf(next))).toEqual([]);
  });

  it("creates a missing family with the source family's policy", () => {
    const source = project([
      screen("hero", "Hero", "en"),
      variant("hero-65", "Hero", "en", "hero"),
      screen("web-de", "Web", "de", { platform: "web", device: "desktop", artboard: { width: 1920, height: 1080 } } as Partial<Screen>),
    ], [synced("en")]);

    expect(missingLocaleScreens(layoutOf(source))).toEqual([
      { locale: "de", sourceLocale: "en", sourceScreenId: "hero", allSizes: true },
    ]);

    const { project: next } = copyScreenToLocale(source, "default", "hero", "de");
    expect(localeNames(next, "de")).toEqual(["Web", "Hero", "Hero@6.5"]);
    expect(layoutOf(next).screenSetPolicies).toContainEqual(synced("de"));
  });

  it("pairs an independent exact-size copy with the same-named target slot", () => {
    const source = project([
      screen("hero", "Hero", "en"),
      variant("hero-65", "Hero", "en", "hero"),
      screen("hero-de", "Hero", "de"),
    ]);

    expect(missingLocaleScreens(layoutOf(source))).toEqual([
      { locale: "de", sourceLocale: "en", sourceScreenId: "hero-65", allSizes: false },
    ]);
    const { project: next, createdScreenId } = copyScreenToLocale(source, "default", "hero-65", "de");
    expect(layoutOf(next).screens.find((candidate) => candidate.id === createdScreenId))
      .toMatchObject({ variantOf: "hero-de", storeTargetId: "6.5" });
  });

  it("rejects copies into the same, an unknown, or a synchronized exact-size slot", () => {
    const source = project([
      screen("hero", "Hero", "en"),
      variant("hero-65", "Hero", "en", "hero"),
      screen("hero-de", "Hero", "de"),
      variant("hero-de-65", "Hero", "de", "hero-de"),
    ], [synced("en"), synced("de")]);

    expect(() => copyScreenToLocale(source, "default", "hero", "en")).toThrow(/already in locale/);
    expect(() => copyScreenToLocale(source, "default", "hero", "fr")).toThrow(/Unknown locale/);
    expect(() => copyScreenToLocale(source, "default", "hero-65", "de")).toThrow(/primary screen/);
  });
});
