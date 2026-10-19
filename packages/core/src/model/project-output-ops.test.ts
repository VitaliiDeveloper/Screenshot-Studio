// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  addScreenToProject,
  copyScreenInProject,
  ensureStoreOutputFamily,
  ensureStoreTargetVariant,
  removeScreenFromProject,
  removeStoreOutputFamily,
  removeStoreTargetVariant,
  reorderScreenInProject,
  resizeScreenArtboard,
  resizeStoreOutputArtboards,
  screenSetModeFor,
  setOutputFamilyScreenSetMode,
} from "./project-ops.js";
import { sampleProject } from "./project-ops-test-fixtures.js";

describe("project-ops", () => {
  it("creates an independent exact store-target variant without mutating the root", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.elements = [{
      id: "headline", type: "text", x: 100, y: 200, width: 500, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Hello", fontFamily: "Inter", size: 60, weight: 400,
      lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
    }];
    const result = ensureStoreTargetVariant(source, "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    });

    expect(result.created).toBe(true);
    expect(source.layouts[0]!.screens).toHaveLength(2);
    expect(result.project.layouts[0]!.screens).toHaveLength(3);
    expect(result.variant).toMatchObject({
      name: "Hero", variantOf: "hero", storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
    });
    expect(result.variant.id).not.toBe("hero");
    expect(result.variant.elements[0]!.id).not.toBe("headline");
    expect(result.variant.elements[0]!.width).toBeLessThan(500);
    expect(source.layouts[0]!.screens[0]!.artboard).toEqual({ width: 1320, height: 2868 });

    const again = ensureStoreTargetVariant(result.project, "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    });
    expect(again.created).toBe(false);
    expect(again.variant.id).toBe(result.variant.id);
    expect(again.project).toBe(result.project);
  });

  it("defaults existing families to independent and reconciles every slot when synchronization is enabled", () => {
    const independent = ensureStoreTargetVariant(sampleProject(), "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    expect(screenSetModeFor(independent.layouts[0]!, independent.layouts[0]!.screens[0]!))
      .toBe("independent");

    const synchronized = setOutputFamilyScreenSetMode(
      independent,
      "default",
      "hero",
      "synchronized",
    );
    const layout = synchronized.layouts[0]!;
    const roots = layout.screens.filter((screen) => screen.storeTargetId === undefined);
    const variants = layout.screens.filter((screen) => screen.storeTargetId === "6.5");

    expect(screenSetModeFor(layout, roots[0]!)).toBe("synchronized");
    expect(variants.map((screen) => screen.variantOf)).toEqual(roots.map((screen) => screen.id));
  });

  it("copies one synchronized logical slot through the core operation", () => {
    const independent = ensureStoreTargetVariant(sampleProject(), "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const synchronized = setOutputFamilyScreenSetMode(
      independent,
      "default",
      "hero",
      "synchronized",
    );
    const sourceVariant = synchronized.layouts[0]!.screens.find((screen) =>
      screen.variantOf === "hero" && screen.storeTargetId === "6.5"
    )!;

    const result = copyScreenInProject(
      synchronized,
      "default",
      sourceVariant.id,
      "blank",
    );
    const layout = result.project.layouts[0]!;
    const roots = layout.screens.filter((screen) => screen.storeTargetId === undefined);
    const variants = layout.screens.filter((screen) => screen.storeTargetId === "6.5");
    const created = layout.screens.find((screen) => screen.id === result.createdScreenId)!;

    expect(roots).toHaveLength(3);
    expect(variants).toHaveLength(3);
    expect(variants.map((screen) => screen.variantOf)).toEqual(roots.map((screen) => screen.id));
    expect(created).toMatchObject({
      name: "Untitled",
      variantOf: roots.at(-1)!.id,
      storeTargetId: "6.5",
      background: { type: "solid", color: "#FFFFFF" },
      elements: [],
    });
  });

  it("preserves an extra independent exact-size slot without creating a primary slot", () => {
    const independent = ensureStoreTargetVariant(sampleProject(), "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const extra = structuredClone(independent.layouts[0]!.screens.find(
      (screen) => screen.storeTargetId === "6.5",
    )!);
    extra.id = "standalone-small";
    extra.name = "Standalone small";
    delete extra.variantOf;
    independent.layouts[0]!.screens.push(extra);

    const removed = removeScreenFromProject(independent, "default", extra.id);

    expect(removed.layouts[0]!.screens.filter((screen) => screen.storeTargetId === undefined))
      .toHaveLength(2);
    expect(removed.layouts[0]!.screens.filter((screen) => screen.storeTargetId === "6.5"))
      .toHaveLength(1);
  });

  it("materializes missing primary slots when Keep 1:1 is enabled from a longer exact-size row", () => {
    const independent = ensureStoreTargetVariant(sampleProject(), "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const firstExact = independent.layouts[0]!.screens.find(
      (screen) => screen.storeTargetId === "6.5",
    )!;
    const extra = structuredClone(firstExact);
    extra.id = "standalone-small";
    extra.name = "Standalone small";
    delete extra.variantOf;
    const secondExtra = structuredClone(firstExact);
    secondExtra.id = "standalone-small-2";
    secondExtra.name = "Standalone small 2";
    delete secondExtra.variantOf;
    independent.layouts[0]!.screens.push(extra, secondExtra);

    const synchronized = setOutputFamilyScreenSetMode(
      independent,
      "default",
      extra.id,
      "synchronized",
    );
    const layout = synchronized.layouts[0]!;
    const primaries = layout.screens.filter((screen) => screen.storeTargetId === undefined);
    const variants = layout.screens.filter((screen) => screen.storeTargetId === "6.5");

    expect(primaries).toHaveLength(3);
    expect(variants).toHaveLength(3);
    expect(variants.map((screen) => screen.variantOf))
      .toEqual(primaries.map((screen) => screen.id));
    expect(variants[1]).toMatchObject({ id: "standalone-small", name: "Standalone small" });
    expect(variants[2]).toMatchObject({ id: "standalone-small-2", name: "Standalone small 2" });
  });

  it("mirrors add, reorder, and delete across exact sizes only in synchronized mode", () => {
    let synchronized = ensureStoreTargetVariant(sampleProject(), "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    synchronized = setOutputFamilyScreenSetMode(
      synchronized,
      "default",
      "hero",
      "synchronized",
    );
    synchronized = addScreenToProject(synchronized, "default", {
      id: "pricing",
      name: "Pricing",
      platform: "apple",
      device: "iphone",
      locale: "en",
      artboard: { width: 1320, height: 2868 },
    });

    let layout = synchronized.layouts[0]!;
    expect(layout.screens.filter((screen) => screen.storeTargetId === undefined)).toHaveLength(3);
    expect(layout.screens.filter((screen) => screen.storeTargetId === "6.5")).toHaveLength(3);

    synchronized = reorderScreenInProject(synchronized, "default", "pricing", 1);
    layout = synchronized.layouts[0]!;
    const roots = layout.screens.filter((screen) => screen.storeTargetId === undefined);
    const variants = layout.screens.filter((screen) => screen.storeTargetId === "6.5");
    expect(roots.map((screen) => screen.id)).toEqual(["pricing", "hero", "details"]);
    expect(variants.map((screen) => screen.variantOf)).toEqual(["pricing", "hero", "details"]);

    const pricingVariant = variants.find((screen) => screen.variantOf === "pricing")!;
    synchronized = reorderScreenInProject(synchronized, "default", pricingVariant.id, 3);
    layout = synchronized.layouts[0]!;
    expect(layout.screens.filter((screen) => screen.storeTargetId === undefined).map((screen) => screen.id))
      .toEqual(["hero", "details", "pricing"]);
    expect(layout.screens.filter((screen) => screen.storeTargetId === "6.5").map((screen) => screen.variantOf))
      .toEqual(["hero", "details", "pricing"]);

    const removed = removeScreenFromProject(synchronized, "default", pricingVariant.id);
    expect(removed.layouts[0]!.screens.some((screen) =>
      screen.id === "pricing" || screen.variantOf === "pricing"
    )).toBe(false);
  });

  it("removes an exact size from every slot in synchronized mode", () => {
    let synchronized = ensureStoreTargetVariant(sampleProject(), "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    synchronized = setOutputFamilyScreenSetMode(
      synchronized,
      "default",
      "hero",
      "synchronized",
    );

    const removed = removeStoreTargetVariant(synchronized, "default", "hero", "6.5");
    expect(removed.layouts[0]!.screens.some((screen) => screen.storeTargetId === "6.5"))
      .toBe(false);
    expect(screenSetModeFor(removed.layouts[0]!, removed.layouts[0]!.screens[0]!))
      .toBe("synchronized");
  });

  it("resizes one screen artboard and its composition atomically", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.artboard = { width: 660, height: 1434 };
    source.layouts[0]!.screens[0]!.elements = [{
      id: "headline", type: "text", x: 40, y: 100, width: 580, height: 200,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Hello", fontFamily: "Inter", size: 72, weight: 400,
      lineHeight: 1.2, letterSpacing: 2, align: "left", color: "#FFFFFF",
      shadow: { color: "#000000", blur: 4, offsetX: -3, offsetY: 5, opacity: 0.8 },
    }, {
      id: "card", type: "shape", x: 20, y: 40, width: 100, height: 80,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#FFFFFF", radius: 6,
      stroke: { color: "#000000", width: 6 },
    }];

    const resized = resizeScreenArtboard(source, "default", "hero", { width: 1320, height: 2868 });

    expect(source.layouts[0]!.screens[0]!.artboard).toEqual({ width: 660, height: 1434 });
    expect(resized.layouts[0]!.screens[0]!.artboard).toEqual({ width: 1320, height: 2868 });
    expect(resized.layouts[0]!.screens[0]!.elements[0]).toMatchObject({
      x: 80, y: 200, width: 1160, height: 400, size: 144, letterSpacing: 4,
      shadow: { blur: 8, offsetX: -6, offsetY: 10 },
    });
    expect(resized.layouts[0]!.screens[0]!.elements[1]).toMatchObject({
      x: 40, y: 80, width: 200, height: 160, radius: 12,
      stroke: { width: 12 },
    });
    expect(resized.layouts[0]!.screens[1]).toEqual(source.layouts[0]!.screens[1]);
  });

  it("scales render-bearing effects with an artboard fit", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.artboard = { width: 100, height: 100 };
    source.layouts[0]!.screens[0]!.elements = [
      {
        id: "headline", type: "text", x: 10, y: 10, width: 80, height: 20,
        rotation: 0, opacity: 1, locked: false, visible: true,
        content: "Hello", fontFamily: "Inter", size: 10, weight: 400,
        lineHeight: 1.2, letterSpacing: 1, align: "left", color: "#FFFFFF",
        shadow: { color: "#000000", blur: 12, offsetX: 4, offsetY: -6, opacity: 0.5 },
      },
      {
        id: "group", type: "group", x: 10, y: 40, width: 80, height: 40,
        rotation: 0, opacity: 1, locked: false, visible: true,
        children: [{
          id: "card", type: "shape", x: 0, y: 0, width: 80, height: 40,
          rotation: 0, opacity: 1, locked: false, visible: true,
          kind: "rect", fill: "#101827", radius: 6,
          stroke: { color: "#FFFFFF", width: 4 },
        }],
      },
      {
        id: "image", type: "image", x: 10, y: 10, width: 20, height: 20,
        rotation: 0, opacity: 1, locked: false, visible: true,
        assetUrl: "assets/image.png", fit: "contain", cornerRadius: 2, blur: 6,
      },
      {
        id: "frame", type: "device-frame", x: 40, y: 10, width: 20, height: 40,
        rotation: 0, opacity: 1, locked: false, visible: true,
        deviceType: "iphone", fit: "cover", blur: 5,
      },
    ];

    const resized = resizeScreenArtboard(source, "default", "hero", { width: 200, height: 200 });

    expect(resized.layouts[0]!.screens[0]!.elements).toMatchObject([
      {
        type: "text",
        shadow: { color: "#000000", blur: 24, offsetX: 8, offsetY: -12, opacity: 0.5 },
      },
      {
        type: "group",
        children: [{
          type: "shape",
          radius: 12,
          stroke: { color: "#FFFFFF", width: 8 },
        }],
      },
      { type: "image", cornerRadius: 4, blur: 12 },
      { type: "device-frame", blur: 10 },
    ]);
  });

  it("rejects artboard fits that exceed bounded visual metrics", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.artboard = { width: 100, height: 100 };
    source.layouts[0]!.screens[0]!.elements = [{
      id: "headline", type: "text", x: 10, y: 10, width: 80, height: 20,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "Hello", fontFamily: "Inter", size: 10, weight: 400,
      lineHeight: 1.2, letterSpacing: 1, align: "left", color: "#FFFFFF",
      shadow: { color: "#000000", blur: 60, offsetX: 0, offsetY: 4, opacity: 0.5 },
    }];
    const original = structuredClone(source);

    expect(() => resizeScreenArtboard(source, "default", "hero", { width: 200, height: 200 }))
      .toThrow('Cannot scale text shadow blur above 100 for element "headline"');
    expect(source).toEqual(original);
  });

  it("resizes one store target output set without changing roots or sibling targets", () => {
    let withTargets = sampleProject();
    for (const rootId of ["hero", "details"]) {
      withTargets = ensureStoreTargetVariant(withTargets, "default", rootId, {
        id: "6.5", width: 1284, height: 2778,
      }).project;
      withTargets = ensureStoreTargetVariant(withTargets, "default", rootId, {
        id: "5.5", width: 1242, height: 2688,
      }).project;
    }
    const source = withTargets.layouts[0]!.screens.find((screen) =>
      screen.variantOf === "hero" && screen.storeTargetId === "6.5"
    )!;
    const originalRoots = withTargets.layouts[0]!.screens.filter((screen) => screen.storeTargetId === undefined);
    const originalSiblingTarget = withTargets.layouts[0]!.screens.filter((screen) => screen.storeTargetId === "5.5");

    const resized = resizeStoreOutputArtboards(withTargets, "default", source.id, {
      width: 642,
      height: 1389,
    });

    const resizedTarget = resized.layouts[0]!.screens.filter((screen) => screen.storeTargetId === "6.5");
    expect(resizedTarget).toHaveLength(2);
    expect(resizedTarget.every((screen) =>
      screen.artboard.width === 642 && screen.artboard.height === 1389
    )).toBe(true);
    expect(resized.layouts[0]!.screens.filter((screen) => screen.storeTargetId === undefined))
      .toEqual(originalRoots);
    expect(resized.layouts[0]!.screens.filter((screen) => screen.storeTargetId === "5.5"))
      .toEqual(originalSiblingTarget);
  });

  it("resizes every master screen in one store output set", () => {
    const source = sampleProject();
    source.layouts[0]!.screens.forEach((screen) => {
      screen.artboard = { width: 660, height: 1434 };
    });

    const resized = resizeStoreOutputArtboards(source, "default", "hero", { width: 1320, height: 2868 });

    expect(resized.layouts[0]!.screens.filter((screen) => screen.variantOf === undefined))
      .toHaveLength(2);
    expect(resized.layouts[0]!.screens.every((screen) =>
      screen.artboard.width === 1320 && screen.artboard.height === 2868
    )).toBe(true);
  });

  it("creates one separate store-output family with synchronized slots and reopens it idempotently", () => {
    const source = sampleProject();
    source.layouts[0]!.screens[0]!.elements = [{
      id: "shape", type: "shape", x: 100, y: 200, width: 500, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#FFFFFF", radius: 20,
    }];
    const result = ensureStoreOutputFamily(source, "default", "hero", "apple", "ipad", {
      id: "13", width: 2064, height: 2752,
    });

    expect(result.created).toBe(true);
    expect(source.layouts[0]!.screens).toHaveLength(2);
    const ipadRoots = result.project.layouts[0]!.screens.filter((screen) =>
      screen.platform === "apple" && screen.device === "ipad",
    );
    expect(ipadRoots).toHaveLength(2);
    expect(ipadRoots.map((screen) => screen.name)).toEqual(["Hero", "Details"]);
    expect(ipadRoots.every((screen) =>
      screen.variantOf === undefined
      && screen.storeTargetId === undefined
      && screen.artboard.width === 2064
      && screen.artboard.height === 2752
      && !["hero", "details"].includes(screen.id)
    )).toBe(true);
    expect(ipadRoots[0]!.elements[0]!.id).not.toBe("shape");
    expect(source.layouts[0]!.screens[0]!.artboard).toEqual({ width: 1320, height: 2868 });
    expect(screenSetModeFor(result.project.layouts[0]!, ipadRoots[0]!)).toBe("synchronized");
    expect(result.project.layouts[0]!.screenSetPolicies).toContainEqual({
      platform: "apple", device: "ipad", locale: "en", mode: "synchronized",
    });

    const again = ensureStoreOutputFamily(result.project, "default", "hero", "apple", "ipad", {
      id: "13", width: 2064, height: 2752,
    });
    expect(again.created).toBe(false);
    expect(again.firstScreen.id).toBe(ipadRoots[0]!.id);
    expect(again.project).toBe(result.project);
  });

  it("removes a complete output family but preserves the last family for a locale", () => {
    const created = ensureStoreOutputFamily(sampleProject(), "default", "hero", "apple", "ipad", {
      id: "13", width: 2064, height: 2752,
    });
    const withVariant = ensureStoreTargetVariant(
      created.project,
      "default",
      created.firstScreen.id,
      { id: "11", width: 1668, height: 2420 },
    ).project;

    const removed = removeStoreOutputFamily(
      withVariant,
      "default",
      created.firstScreen.id,
    );
    expect(removed.layouts[0]!.screens.every((screen) => screen.device === "iphone")).toBe(true);
    expect(removed.layouts[0]!.screenSetPolicies ?? []).not.toContainEqual(expect.objectContaining({
      platform: "apple", device: "ipad", locale: "en",
    }));
    expect(() => removeStoreOutputFamily(removed, "default", "hero"))
      .toThrow(/last output family/);
  });

  it("removes an output family only from the source locale", () => {
    const created = ensureStoreOutputFamily(sampleProject(), "default", "hero", "apple", "ipad", {
      id: "13", width: 2064, height: 2752,
    });
    const frenchIpad = {
      ...structuredClone(created.firstScreen),
      id: "ipad-fr",
      locale: "fr",
    };
    const withFrench = {
      ...created.project,
      layouts: [{
        ...created.project.layouts[0]!,
        screens: [...created.project.layouts[0]!.screens, frenchIpad],
      }],
    };

    const removed = removeStoreOutputFamily(
      withFrench,
      "default",
      created.firstScreen.id,
    );

    expect(removed.layouts[0]!.screens).toContainEqual(frenchIpad);
    expect(removed.layouts[0]!.screens.some((screen) => (
      screen.device === "ipad" && screen.locale === "en"
    ))).toBe(false);
  });

  it("creates new watchOS output families with 3.5x custom masters", () => {
    const source = sampleProject();
    const result = ensureStoreOutputFamily(source, "default", "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });

    const watchRoots = result.project.layouts[0]!.screens.filter((screen) =>
      screen.platform === "apple"
      && screen.device === "watchos"
      && screen.variantOf === undefined,
    );
    expect(result.created).toBe(true);
    expect(watchRoots).toHaveLength(2);
    expect(watchRoots.every((screen) =>
      screen.storeTargetId === undefined
      && screen.artboard.width === 1477
      && screen.artboard.height === 1799
    )).toBe(true);
    expect(source.layouts[0]!.screens.map((screen) => screen.artboard)).toEqual([
      { width: 1320, height: 2868 },
      { width: 1320, height: 2868 },
    ]);

    const variant = ensureStoreTargetVariant(result.project, "default", watchRoots[0]!.id, {
      id: "series-11", width: 416, height: 496,
    }).variant;
    expect(variant).toMatchObject({
      variantOf: watchRoots[0]!.id,
      storeTargetId: "series-11",
      artboard: { width: 1456, height: 1736 },
    });
  });

  it("reuses an existing target output set size for newly added variants", () => {
    const family = ensureStoreOutputFamily(sampleProject(), "default", "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });
    const watchRoots = family.project.layouts[0]!.screens.filter((screen) =>
      screen.platform === "apple"
      && screen.device === "watchos"
      && screen.variantOf === undefined
    );
    const first = ensureStoreTargetVariant(family.project, "default", watchRoots[0]!.id, {
      id: "series-11", width: 416, height: 496,
    });
    const resized = resizeStoreOutputArtboards(first.project, "default", first.variant.id, {
      width: 832,
      height: 992,
    });

    const second = ensureStoreTargetVariant(resized, "default", watchRoots[1]!.id, {
      id: "series-11", width: 416, height: 496,
    });

    expect(second.variant.artboard).toEqual({ width: 832, height: 992 });
  });

  it("derives watchOS masters from the supplied lead dimensions", () => {
    const result = ensureStoreOutputFamily(sampleProject(), "default", "hero", "apple", "watchos", {
      id: "custom-watch-lead", width: 400, height: 500,
    });

    expect(result.firstScreen.artboard).toEqual({ width: 1400, height: 1750 });
  });

  it("rejects watchOS lead dimensions that cannot produce an integer 3.5x master", () => {
    const source = sampleProject();

    expect(() => ensureStoreOutputFamily(source, "default", "hero", "apple", "watchos", {
      id: "fractional-watch-lead", width: 401, height: 501,
    })).toThrow(/derived artboard must use integer dimensions/);
    expect(source.layouts[0]!.screens).toHaveLength(2);
  });

  it("rejects watchOS variant dimensions that cannot produce an integer 3.5x artboard", () => {
    const family = ensureStoreOutputFamily(sampleProject(), "default", "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });
    const before = family.project;

    expect(() => ensureStoreTargetVariant(before, "default", family.firstScreen.id, {
      id: "fractional-watch-target", width: 401, height: 501,
    })).toThrow(/derived artboard must use integer dimensions/);
    expect(before.layouts[0]!.screens).toHaveLength(4);
  });

  it("reopens an existing fixed watchOS family without resizing it", () => {
    const source = sampleProject();
    source.layouts[0]!.screens.push({
      ...structuredClone(source.layouts[0]!.screens[0]!),
      id: "existing-watch",
      platform: "apple",
      device: "watchos",
      artboard: { width: 422, height: 514 },
      elements: [],
    });

    const result = ensureStoreOutputFamily(source, "default", "hero", "apple", "watchos", {
      id: "ultra-3", width: 422, height: 514,
    });

    expect(result.created).toBe(false);
    expect(result.project).toBe(source);
    expect(result.firstScreen.id).toBe("existing-watch");
    expect(result.firstScreen.artboard).toEqual({ width: 422, height: 514 });
  });

  it("removes one target variant and preserves independent exact screens when their primary is removed", () => {
    const first = ensureStoreTargetVariant(sampleProject(), "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const withoutVariant = removeStoreTargetVariant(first, "default", "hero", "6.5");
    expect(withoutVariant.layouts[0]!.screens.map((screen) => screen.id)).toEqual(["hero", "details"]);

    const recreated = ensureStoreTargetVariant(first, "default", "details", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const withoutRoot = removeScreenFromProject(recreated, "default", "details");
    expect(withoutRoot.layouts[0]!.screens).toHaveLength(3);
    const detached = withoutRoot.layouts[0]!.screens.find((screen) =>
      screen.storeTargetId === "6.5" && screen.name === "Details"
    )!;
    expect(detached.variantOf).toBeUndefined();

    const cascaded = removeScreenFromProject(recreated, "default", "details", {
      cascadeVariants: true,
    });
    expect(cascaded.layouts[0]!.screens).toHaveLength(2);
    expect(cascaded.layouts[0]!.screens.every((screen) =>
      screen.id === "hero" || screen.variantOf === "hero"
    )).toBe(true);
  });

  it("removes the complete independent exact-size row", () => {
    const first = ensureStoreTargetVariant(sampleProject(), "default", "hero", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const second = ensureStoreTargetVariant(first, "default", "details", {
      id: "6.5", width: 1284, height: 2778,
    }).project;
    const exact = second.layouts[0]!.screens.find((screen) => screen.storeTargetId === "6.5")!;
    const standalone = structuredClone(exact);
    standalone.id = "standalone-small";
    delete standalone.variantOf;
    second.layouts[0]!.screens.push(standalone);

    const removed = removeStoreTargetVariant(second, "default", "hero", "6.5");

    expect(removed.layouts[0]!.screens.some((screen) => screen.storeTargetId === "6.5"))
      .toBe(false);
    expect(removed.layouts[0]!.screens.map((screen) => screen.id)).toEqual(["hero", "details"]);
  });

  it("refuses to remove the last root screen for one locale", () => {
    const withUkrainian = addScreenToProject(sampleProject(), "default", {
      id: "uk-root",
      platform: "apple",
      device: "iphone",
      locale: "uk",
      artboard: { width: 1320, height: 2868 },
    });

    expect(() => removeScreenFromProject(withUkrainian, "default", "uk-root"))
      .toThrow('Cannot remove the last root screen for locale "uk"');
    expect(removeScreenFromProject(withUkrainian, "default", "details").layouts[0]!.screens.map((screen) => screen.id))
      .toContain("uk-root");
  });
});
