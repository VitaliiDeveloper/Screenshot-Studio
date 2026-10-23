// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  Project as ProjectSchema,
  createShapeElement,
  ensureStoreTargetVariant,
  getLayout,
  setOutputFamilyScreenSetMode,
  type Project,
  type Screen,
} from "@screenshot-studio/core/model";
import { DEFAULT_STORE_SPECS, findStoreTarget } from "./specs.js";
import { buildBundleEntries, validateBundleArtboards } from "./bundle.js";
import { migrateLeadTarget } from "./lead-migration.js";

const specs = DEFAULT_STORE_SPECS;
const target = (id: string) => findStoreTarget(specs, "apple", "iphone", id);

function screen(id: string, locale = "en", width = 1320, height = 2868): Screen {
  return {
    id,
    name: id,
    platform: "apple",
    device: "iphone",
    locale,
    direction: "ltr",
    artboard: { width, height },
    background: { type: "solid", color: "#101827" },
    elements: [{ ...createShapeElement({ x: 0, y: 0 }), id: `${id}-panel`, width: 1320, height: 2868 }],
  };
}

function project(...screens: Screen[]): Project {
  return ProjectSchema.parse({
    meta: { name: "Lead", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{ id: "default", name: "Default", mode: "isolated", screens }],
  });
}

const screens = (value: Project) => getLayout(value, "default").screens;

describe("migrateLeadTarget", () => {
  const geometry = (value: Screen) => value.elements.map(({ id: _id, ...rest }) => rest);

  it("fits the root in place and keeps its original content as the previous-lead variant", () => {
    const withVariant = ensureStoreTargetVariant(project(screen("hero")), "default", "hero", target("6.5")).project;
    const original = screens(withVariant)[0]!;

    const { project: migrated, migrated: report } = migrateLeadTarget(withVariant, specs, "apple", "iphone", "6.9");

    const [root, sixFive, sixNine] = screens(migrated);
    expect(report).toEqual([{ layoutId: "default", locale: "en", screens: 1 }]);
    expect(root).toMatchObject({ id: "hero", artboard: { width: 1206, height: 2622 } });
    expect(root!.storeTargetId).toBeUndefined();
    expect(root!.elements[0]).toMatchObject({ id: "hero-panel", width: 1206, y: expect.closeTo(0.85, 2) });
    expect(sixFive).toEqual(screens(withVariant)[1]);
    expect(sixNine).toMatchObject({
      name: "hero",
      variantOf: "hero",
      storeTargetId: "6.9",
      artboard: original.artboard,
      background: original.background,
    });
    expect(geometry(sixNine!)).toEqual(geometry(original));
    expect(() => validateBundleArtboards(buildBundleEntries(migrated, "default", specs))).not.toThrow();
  });

  it("swaps content with an existing lead variant without refitting either", () => {
    const base = ensureStoreTargetVariant(project(screen("hero")), "default", "hero", target("6.3")).project;
    const [original, authored] = screens(base);

    const migrated = screens(migrateLeadTarget(base, specs, "apple", "iphone", "6.9").project);

    expect(migrated).toEqual([
      { ...original, artboard: authored!.artboard, elements: authored!.elements },
      { ...authored, storeTargetId: "6.9", artboard: original!.artboard, elements: original!.elements },
    ]);
  });

  it("keeps synchronized slot order across locales and is idempotent", () => {
    let base = project(screen("a"), screen("b"), screen("c", "de"), screen("d", "de"));
    base = setOutputFamilyScreenSetMode(base, "default", "a", "synchronized");
    base = ensureStoreTargetVariant(base, "default", "a", target("6.5")).project;

    const { project: migrated, migrated: report } = migrateLeadTarget(base, specs, "apple", "iphone", "6.9");

    expect(report.map(({ locale, screens: count }) => [locale, count])).toEqual([["en", 2], ["de", 2]]);
    const en = screens(migrated).filter(({ locale }) => locale === "en");
    expect(en.filter(({ storeTargetId }) => storeTargetId === undefined).map(({ id }) => id)).toEqual(["a", "b"]);
    for (const targetId of ["6.9", "6.5"]) {
      expect(en.filter(({ storeTargetId }) => storeTargetId === targetId).map(({ variantOf }) => variantOf))
        .toEqual(["a", "b"]);
    }

    const again = migrateLeadTarget(migrated, specs, "apple", "iphone", "6.9");
    expect(again.migrated).toEqual([]);
    expect(again.project).toBe(migrated);
  });

  it("leaves families already authored at the current lead untouched", () => {
    const base = project(screen("hero", "en", 1206, 2622));
    expect(migrateLeadTarget(base, specs, "apple", "iphone", "6.9")).toEqual({ project: base, migrated: [] });
  });

  it("refuses ambiguous families instead of guessing", () => {
    expect(() => migrateLeadTarget(
      project(screen("old"), screen("new", "en", 1206, 2622)),
      specs, "apple", "iphone", "6.9",
    )).toThrow(/primary screens "new" do not match the previous lead "6.9"/);

    expect(() => migrateLeadTarget(
      project(screen("hero"), { ...screen("loose", "en", 1206, 2622), storeTargetId: "6.3" }),
      specs, "apple", "iphone", "6.9",
    )).toThrow(/screens "loose" already use "6.9", are standalone "6.3" screens/);

    expect(() => migrateLeadTarget(project(screen("hero")), specs, "apple", "iphone", "6.3"))
      .toThrow(/already the apple\/iphone lead target/);
  });

  it("moves Android tablet roots from the 10:16 lead to the 9:16 lead", () => {
    const tablet = { ...screen("tablet", "en", 1200, 1920), platform: "android", device: "tablet-7" } as Screen;

    const { project: migrated, migrated: report } = migrateLeadTarget(
      project(tablet), specs, "android", "tablet-7", "tablet-7-portrait",
    );

    expect(report).toEqual([{ layoutId: "default", locale: "en", screens: 1 }]);
    const [root, previous] = screens(migrated);
    expect(root).toMatchObject({ id: "tablet", artboard: { width: 1440, height: 2560 } });
    expect(previous).toMatchObject({
      variantOf: "tablet", storeTargetId: "tablet-7-portrait", artboard: { width: 1200, height: 1920 },
    });
    expect(() => validateBundleArtboards(buildBundleEntries(migrated, "default", specs))).not.toThrow();
  });
});
