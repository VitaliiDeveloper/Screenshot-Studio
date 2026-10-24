// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from "vitest";
import { editorStore } from "./editor-store.js";
import { parseProject, type Project } from "@screenshot-studio/core/model";
import { patchText, project } from "./editor-store-test-fixtures.js";

describe("editorStore screens (slice 4)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [] });
    editorStore.getState().load(project());
  });

  it("selectScreen sets active and clears selection", () => {
    editorStore.getState().select("headline");
    editorStore.getState().selectScreen("second");
    expect(editorStore.getState().activeScreenId).toBe("second");
    expect(editorStore.getState().selectedItems).toEqual([]);
  });

  it("addScreen duplicates the active screen with fresh ids, appended and active", () => {
    const before = editorStore.getState().project!.layouts[0]!.screens.length;
    editorStore.getState().addScreen();
    const screens = editorStore.getState().project!.layouts[0]!.screens;
    expect(screens).toHaveLength(before + 1);
    const added = screens[screens.length - 1]!;
    expect(added.id).not.toBe("hero");
    const addedEl = added.elements[0]!;
    expect(addedEl.id).not.toBe("headline"); // element id regenerated
    expect(addedEl.type === "text" && addedEl.content).toBe("Hello"); // content copied
    expect(editorStore.getState().activeScreenId).toBe(added.id);
  });

  it("addBlankScreen keeps the active output settings without copying layers", () => {
    editorStore.getState().addBlankScreen();
    const screens = editorStore.getState().project!.layouts[0]!.screens;
    const added = screens[screens.length - 1]!;
    expect(added).toMatchObject({
      name: "Untitled",
      platform: "apple",
      device: "iphone",
      locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#FFFFFF" },
      elements: [],
    });
    expect(added.id).not.toBe("hero");
    expect(editorStore.getState().activeScreenId).toBe(added.id);
  });

  it("addScreen duplicates the active target variant onto an available existing root", () => {
    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    const sourceVariant = editorStore.getState().project!.layouts[0]!.screens
      .find((screen) => screen.variantOf === "hero" && screen.storeTargetId === "6.5")!;
    editorStore.getState().selectScreen(sourceVariant.id);
    const variantText = sourceVariant.elements[0]!;
    if (variantText.type !== "text") throw new Error("expected text variant element");
    patchText(variantText.id, { content: "Variant only" }, sourceVariant.id);

    editorStore.getState().addScreen();

    const state = editorStore.getState();
    const addedVariant = state.project!.layouts[0]!.screens
      .find((screen) => screen.id === state.activeScreenId)!;
    const addedRoot = state.project!.layouts[0]!.screens
      .find((screen) => screen.id === addedVariant.variantOf)!;
    expect(addedVariant).toMatchObject({
      name: "Hero copy",
      storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
    });
    expect(addedRoot).toMatchObject({
      id: "second",
      name: "Second",
      artboard: { width: 660, height: 1434 },
    });
    expect(addedRoot.variantOf).toBeUndefined();
    expect(addedRoot.storeTargetId).toBeUndefined();
    expect(addedVariant.elements[0]).toMatchObject({ type: "text", content: "Variant only" });
    expect(addedRoot.elements).toEqual([]);
    expect(addedVariant.elements[0]!.id).not.toBe(sourceVariant.elements[0]!.id);
    expect(state.project!.layouts[0]!.screens.filter((screen) => screen.storeTargetId === undefined))
      .toHaveLength(2);
    expect(() => parseProject(state.project)).not.toThrow();
  });

  it("keeps four masters unchanged when adding a second blank screen to a one-screen variant", () => {
    editorStore.getState().addBlankScreen();
    editorStore.getState().addBlankScreen();
    const rootsBefore = editorStore.getState().project!.layouts[0]!.screens
      .filter((screen) => screen.storeTargetId === undefined);
    expect(rootsBefore).toHaveLength(4);
    const sourceRoot = rootsBefore[3]!;
    editorStore.getState().selectScreen(sourceRoot.id);
    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    const sourceVariant = editorStore.getState().project!.layouts[0]!.screens
      .find((screen) => screen.variantOf === sourceRoot.id && screen.storeTargetId === "6.5")!;
    editorStore.getState().selectScreen(sourceVariant.id);

    editorStore.getState().addBlankScreen();

    const state = editorStore.getState();
    const addedVariant = state.project!.layouts[0]!.screens
      .find((screen) => screen.id === state.activeScreenId)!;
    const addedRoot = state.project!.layouts[0]!.screens
      .find((screen) => screen.id === addedVariant.variantOf)!;
    expect(addedVariant).toMatchObject({
      name: "Untitled",
      storeTargetId: "6.5",
      artboard: { width: 1284, height: 2778 },
      elements: [],
    });
    expect(addedRoot).toMatchObject({
      id: "hero",
      name: "Hero",
      artboard: { width: 660, height: 1434 },
    });
    expect(addedRoot.variantOf).toBeUndefined();
    expect(addedRoot.storeTargetId).toBeUndefined();
    expect(state.project!.layouts[0]!.screens.filter((screen) => screen.storeTargetId === undefined))
      .toHaveLength(4);
    expect(state.project!.layouts[0]!.screens.filter((screen) => screen.storeTargetId === "6.5"))
      .toHaveLength(2);
    expect(() => parseProject(state.project)).not.toThrow();
  });

  it("adds a standalone target screen after every existing primary has the active target variant", () => {
    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    editorStore.getState().selectScreen("second");
    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    const sourceVariant = editorStore.getState().project!.layouts[0]!.screens
      .find((screen) => screen.variantOf === "second" && screen.storeTargetId === "6.5")!;
    editorStore.getState().selectScreen(sourceVariant.id);

    editorStore.getState().addBlankScreen();

    const state = editorStore.getState();
    const roots = state.project!.layouts[0]!.screens.filter(
      (screen) => screen.storeTargetId === undefined,
    );
    const addedVariant = state.project!.layouts[0]!.screens
      .find((screen) => screen.id === state.activeScreenId)!;
    expect(roots).toHaveLength(2);
    expect(addedVariant).toMatchObject({
      name: "Untitled",
      storeTargetId: "6.5",
      elements: [],
    });
    expect(addedVariant.variantOf).toBeUndefined();
    expect(() => parseProject(state.project)).not.toThrow();
  });

  it("mirrors an added target slot only after Keep 1:1 is enabled", () => {
    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    const sourceVariant = editorStore.getState().project!.layouts[0]!.screens
      .find((screen) => screen.variantOf === "hero" && screen.storeTargetId === "6.5")!;
    editorStore.getState().selectScreen(sourceVariant.id);
    editorStore.getState().setOutputFamilyScreenSetMode("synchronized");

    editorStore.getState().addBlankScreen();

    const state = editorStore.getState();
    const primaries = state.project!.layouts[0]!.screens.filter(
      (screen) => screen.storeTargetId === undefined,
    );
    const variants = state.project!.layouts[0]!.screens.filter(
      (screen) => screen.storeTargetId === "6.5",
    );
    expect(primaries).toHaveLength(3);
    expect(variants).toHaveLength(3);
    expect(variants.map((screen) => screen.variantOf))
      .toEqual(primaries.map((screen) => screen.id));
  });

  it("creates an independent target variant without leaving the active screen", () => {
    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    const created = editorStore.getState();
    const variant = created.project!.layouts[0]!.screens.find((screen) => screen.storeTargetId === "6.5")!;
    expect(variant).toMatchObject({ variantOf: "hero", artboard: { width: 1284, height: 2778 } });
    expect(created.project!.layouts[0]!.screens[0]!.artboard).toEqual({ width: 660, height: 1434 });
    expect(created.activeScreenId).toBe("hero");

    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    expect(editorStore.getState().project!.layouts[0]!.screens.filter((screen) => screen.storeTargetId === "6.5")).toHaveLength(1);
    expect(editorStore.getState().activeScreenId).toBe("hero");

    editorStore.getState().selectScreen(variant.id);
    expect(editorStore.getState().activeScreenId).toBe(variant.id);

    editorStore.getState().removeStoreTargetVariant("hero", "6.5");
    expect(editorStore.getState().project!.layouts[0]!.screens).toHaveLength(2);
    expect(editorStore.getState().activeScreenId).toBe("hero");

    editorStore.getState().undo();
    expect(editorStore.getState().project!.layouts[0]!.screens.filter((screen) => screen.storeTargetId === "6.5"))
      .toEqual([variant]);
  });

  it("creates and selects an independent store-output family without changing the source", () => {
    editorStore.getState().ensureStoreOutputFamily("windows", "desktop", {
      id: "4k", label: "Windows desktop 4K", width: 3840, height: 2160, orientation: "landscape",
    });
    const created = editorStore.getState();
    const windowsRoots = created.project!.layouts[0]!.screens.filter((screen) => screen.platform === "windows");
    expect(windowsRoots).toHaveLength(2);
    expect(windowsRoots.every((screen) =>
      screen.device === "desktop"
      && screen.variantOf === undefined
      && screen.artboard.width === 3840
      && screen.artboard.height === 2160
    )).toBe(true);
    expect(created.project!.layouts[0]!.screens.find((screen) => screen.id === "hero")!.artboard).toEqual({ width: 660, height: 1434 });
    expect(created.activeScreenId).toBe(windowsRoots[0]!.id);

    editorStore.getState().ensureStoreOutputFamily("windows", "desktop", {
      id: "4k", label: "Windows desktop 4K", width: 3840, height: 2160, orientation: "landscape",
    });
    expect(editorStore.getState().project!.layouts[0]!.screens.filter((screen) => screen.platform === "windows")).toHaveLength(2);

    editorStore.getState().removeStoreOutputFamily(windowsRoots[0]!.id);
    expect(editorStore.getState().project!.layouts[0]!.screens.some((screen) => screen.platform === "windows")).toBe(false);
    editorStore.getState().undo();
    expect(editorStore.getState().project!.layouts[0]!.screens.filter((screen) => screen.platform === "windows"))
      .toEqual(windowsRoots);
  });

  it("creates and selects a watchOS family with 3.5x custom masters", () => {
    editorStore.getState().ensureStoreOutputFamily("apple", "watchos", {
      id: "ultra-3",
      label: "Apple Watch Ultra 3 (lead)",
      width: 422,
      height: 514,
      orientation: "portrait",
    });

    const state = editorStore.getState();
    const watchRoots = state.project!.layouts[0]!.screens.filter((screen) =>
      screen.device === "watchos" && screen.variantOf === undefined,
    );
    expect(watchRoots).toHaveLength(2);
    expect(watchRoots.every((screen) =>
      screen.artboard.width === 1477 && screen.artboard.height === 1799
    )).toBe(true);
    expect(state.activeScreenId).toBe(watchRoots[0]!.id);
    expect(state.project!.layouts[0]!.screens.find((screen) => screen.id === "hero")!.artboard)
      .toEqual({ width: 660, height: 1434 });

    editorStore.getState().ensureStoreTargetVariant({
      id: "series-11",
      label: "Apple Watch Series 11",
      width: 416,
      height: 496,
      orientation: "portrait",
    });
    const variant = editorStore.getState().project!.layouts[0]!.screens.find((screen) =>
      screen.variantOf === watchRoots[0]!.id && screen.storeTargetId === "series-11"
    );
    expect(variant?.artboard).toEqual({ width: 1456, height: 1736 });
  });

  it("reorders variants only inside the visible platform/device target layer", () => {
    const current = editorStore.getState().project!;
    const heroVariant: Project["layouts"][number]["screens"][number] = {
      ...structuredClone(current.layouts[0]!.screens[0]!),
      id: "hero-65",
      platform: "apple",
      device: "iphone",
      variantOf: "hero",
      storeTargetId: "6.5",
    };
    const secondVariant: Project["layouts"][number]["screens"][number] = {
      ...structuredClone(current.layouts[0]!.screens[1]!),
      id: "second-65",
      platform: "apple",
      device: "iphone",
      variantOf: "second",
      storeTargetId: "6.5",
    };
    const ipadRoot: Project["layouts"][number]["screens"][number] = {
      ...structuredClone(current.layouts[0]!.screens[0]!),
      id: "ipad-root",
      platform: "apple",
      device: "ipad",
    };
    const ipadVariant: Project["layouts"][number]["screens"][number] = {
      ...structuredClone(ipadRoot),
      id: "ipad-65",
      platform: "apple",
      device: "ipad",
      variantOf: "ipad-root",
      storeTargetId: "6.5",
    };
    editorStore.getState().replaceProject({
      ...current,
      layouts: [{
        ...current.layouts[0]!,
        screens: [current.layouts[0]!.screens[0]!, current.layouts[0]!.screens[1]!, heroVariant, ipadRoot, ipadVariant, secondVariant],
      }],
    });

    editorStore.getState().reorderScreens("hero-65", "second-65");

    expect(editorStore.getState().project!.layouts[0]!.screens.map((screen) => screen.id)).toEqual([
      "hero", "second", "second-65", "ipad-root", "ipad-65", "hero-65",
    ]);
  });

  it("removeScreen deletes and reassigns active when the active screen goes", () => {
    editorStore.getState().removeScreen("hero"); // hero was active
    const screens = editorStore.getState().project!.layouts[0]!.screens;
    expect(screens.map((s) => s.id)).toEqual(["second"]);
    expect(editorStore.getState().activeScreenId).toBe("second");
  });

  it("removeScreen is a no-op on the last remaining screen", () => {
    editorStore.getState().removeScreen("second");
    editorStore.getState().removeScreen("hero"); // now the only one
    expect(editorStore.getState().project!.layouts[0]!.screens.map((s) => s.id)).toEqual(["hero"]);
  });
});

describe("editorStore locale workspace (phase 4 slice 4)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [] });
    editorStore.getState().load(project());
  });

  it("selectLocale activates the first screen in that locale", () => {
    editorStore.getState().addLocale("en", "ar", "rtl");
    editorStore.getState().selectLocale("en");

    expect(editorStore.getState().activeScreenId).toBe("hero");
    editorStore.getState().selectLocale("ar");
    const active = editorStore.getState().project!.layouts[0]!.screens
      .find((screen) => screen.id === editorStore.getState().activeScreenId);
    expect(active?.locale).toBe("ar");
  });

  it("adds an RTL locale with fresh ids and makes it active", () => {
    editorStore.getState().addLocale("en", "ar", "rtl");
    const state = editorStore.getState();
    const arabic = state.project!.layouts[0]!.screens.filter((screen) => screen.locale === "ar");

    expect([...new Set(state.project!.layouts[0]!.screens.map((screen) => screen.locale))])
      .toEqual(["en", "ar"]);
    expect(arabic).toHaveLength(2);
    expect(arabic.every((screen) => screen.direction === "rtl")).toBe(true);
    expect(arabic.map((screen) => screen.id)).not.toEqual(["hero", "second"]);
    expect(arabic.some((screen) => screen.id === state.activeScreenId)).toBe(true);
  });

  it("changes direction idempotently and removes a complete locale", () => {
    editorStore.getState().addLocale("en", "ar", "rtl");
    const rtl = structuredClone(editorStore.getState().project!);
    editorStore.getState().setLocaleDirection("ar", "rtl");
    expect(editorStore.getState().project).toEqual(rtl);

    editorStore.getState().setLocaleDirection("ar", "ltr");
    expect(editorStore.getState().project!.layouts[0]!.screens
      .filter((screen) => screen.locale === "ar")
      .every((screen) => screen.direction === "ltr")).toBe(true);

    editorStore.getState().removeLocale("ar");
    expect([...new Set(editorStore.getState().project!.layouts[0]!.screens.map((screen) => screen.locale))])
      .toEqual(["en"]);
    expect(editorStore.getState().activeScreenId).toBe("hero");
  });

  it("reorders locale screens by id without moving other locale slots", () => {
    editorStore.getState().addLocale("en", "ar", "ltr");
    const current = editorStore.getState().project!;
    const [enFirst, enSecond] = current.layouts[0]!.screens.filter((screen) => screen.locale === "en");
    const [arFirst, arSecond] = current.layouts[0]!.screens.filter((screen) => screen.locale === "ar");
    editorStore.getState().replaceProject({
      ...current,
      layouts: [{ ...current.layouts[0]!, screens: [enFirst!, arFirst!, enSecond!, arSecond!] }],
    });

    editorStore.getState().reorderScreens(arFirst!.id, arSecond!.id);

    expect(editorStore.getState().project!.layouts[0]!.screens.map((screen) => screen.id)).toEqual([
      enFirst!.id,
      arSecond!.id,
      enSecond!.id,
      arFirst!.id,
    ]);
  });

  it("keeps screen selection in the active locale after an interleaved deletion", () => {
    editorStore.getState().addLocale("en", "ar", "ltr");
    const current = editorStore.getState().project!;
    const [enFirst, enSecond] = current.layouts[0]!.screens.filter((screen) => screen.locale === "en");
    const [arFirst, arSecond] = current.layouts[0]!.screens.filter((screen) => screen.locale === "ar");
    editorStore.getState().replaceProject({
      ...current,
      layouts: [{ ...current.layouts[0]!, screens: [enFirst!, arFirst!, enSecond!, arSecond!] }],
    });
    editorStore.getState().selectScreen(enFirst!.id);

    editorStore.getState().removeScreen(enFirst!.id);

    expect(editorStore.getState().activeScreenId).toBe(enSecond!.id);
  });

  it("protects the final screen in a locale from screen-level removal", () => {
    editorStore.getState().addLocale("en", "ar", "rtl");
    const arabic = editorStore.getState().project!.layouts[0]!.screens
      .filter((screen) => screen.locale === "ar");
    editorStore.getState().removeScreen(arabic[1]!.id);
    const remaining = editorStore.getState().project!.layouts[0]!.screens
      .find((screen) => screen.locale === "ar")!;

    editorStore.getState().removeScreen(remaining.id);

    expect(editorStore.getState().project!.layouts[0]!.screens
      .filter((screen) => screen.locale === "ar"))
      .toEqual([remaining]);
    expect(editorStore.getState().project!.layouts[0]!.screens.some((screen) => screen.locale === "ar"))
      .toBe(true);
  });
});

describe("editorStore elements (slice 4)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [] });
    editorStore.getState().load(project());
    // give the active screen a second element so reorder is observable
    editorStore.setState((s) => {
      const p = structuredClone(s.project!);
      p.layouts[0]!.screens[0]!.elements.push({
        id: "accent", type: "shape", x: 0, y: 0, width: 100, height: 100,
        rotation: 0, opacity: 1, locked: false, visible: true,
        kind: "rect", fill: "#FF0000", radius: 0,
      } as never);
      return { project: p };
    });
  });

  it("reorderElements changes z-order (array order)", () => {
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements.map((e) => e.id))
      .toEqual(["headline", "accent"]);
    editorStore.getState().reorderElements(0, 1);
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements.map((e) => e.id))
      .toEqual(["accent", "headline"]);
  });

  it("removeElement drops the element and clears matching selection", () => {
    editorStore.getState().select("accent");
    editorStore.getState().removeElement("accent");
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements.map((e) => e.id))
      .toEqual(["headline"]);
    expect(editorStore.getState().selectedItems).toEqual([]);
  });

  it("patchElement can set locked, visible and name", () => {
    patchText("headline", { locked: true, visible: false, name: "Big" });
    const el = editorStore.getState().project!.layouts[0]!.screens[0]!.elements
      .find((e) => e.id === "headline")!;
    expect(el).toMatchObject({ locked: true, visible: false, name: "Big" });
  });
});

describe("editorStore screen editors (slice 5)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [] });
    editorStore.getState().load(project());
  });

  it("setBackground replaces the active screen's strict background", () => {
    editorStore.getState().setBackground({
      type: "linear-gradient", from: "#ABCDEF", to: "#123456", angle: 45,
    });
    const bg = editorStore.getState().project!.layouts[0]!.screens[0]!.background;
    expect(bg).toEqual({ type: "linear-gradient", from: "#ABCDEF", to: "#123456", angle: 45 });
  });

  it("resizeArtboard updates the active root and scales its composition", () => {
    editorStore.getState().resizeArtboard({ width: 1320, height: 2868 });
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.artboard)
      .toEqual({ width: 1320, height: 2868 });
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0])
      .toMatchObject({ x: 80, y: 200, width: 1160, height: 400, size: 144 });
  });

  it("resizeArtboard updates every master screen in the active output set", () => {
    editorStore.getState().resizeArtboard({ width: 1320, height: 2868 });
    expect(editorStore.getState().project!.layouts[0]!.screens[1]!.artboard)
      .toEqual({ width: 1320, height: 2868 });
  });

  it("resizeArtboard updates only the active store target output set", () => {
    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    editorStore.getState().selectScreen("second");
    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    const before = editorStore.getState().project!;
    const originalRoots = structuredClone(
      before.layouts[0]!.screens.filter((screen) => screen.storeTargetId === undefined),
    );
    const variant = before.layouts[0]!.screens.find(
      (screen) => screen.variantOf === "hero" && screen.storeTargetId === "6.5",
    )!;

    editorStore.getState().selectScreen(variant.id);
    editorStore.getState().resizeArtboard({ width: 642, height: 1389 });

    const resized = editorStore.getState().project!;
    const targetScreens = resized.layouts[0]!.screens.filter(
      (screen) => screen.storeTargetId === "6.5",
    );
    expect(targetScreens).toHaveLength(2);
    expect(targetScreens.every((screen) =>
      screen.artboard.width === 642 && screen.artboard.height === 1389
    )).toBe(true);
    expect(resized.layouts[0]!.screens.filter((screen) => screen.storeTargetId === undefined))
      .toEqual(originalRoots);
  });
});

describe("editorStore connected workspace hardening (phase 6 slice 7)", () => {
  it("reorders only exact connected-group slots", () => {
    const connected = project();
    connected.layouts[0]!.mode = "connected";
    const unrelated: Project["layouts"][number]["screens"][number] = {
      id: "unrelated",
      name: "Unrelated",
      platform: "android",
      device: "phone",
      locale: "en",
      direction: "ltr",
      artboard: { width: 540, height: 960 },
      background: { type: "solid", color: "#222222" },
      elements: [],
    };
    connected.layouts[0]!.screens = [connected.layouts[0]!.screens[0]!, unrelated, connected.layouts[0]!.screens[1]!];
    editorStore.getState().load(connected);

    editorStore.getState().reorderScreens("hero", "second");
    expect(editorStore.getState().project!.layouts[0]!.screens.map((screen) => screen.id))
      .toEqual(["second", "unrelated", "hero"]);
  });
});
