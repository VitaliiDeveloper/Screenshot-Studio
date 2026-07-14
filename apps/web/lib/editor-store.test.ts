// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from "vitest";
import { editorStore } from "./editor-store.js";
import { applyElementPatch, type ElementPatchFor } from "./editor-element-patch.js";
import {
  createSelectedElementIndex,
  forEachSelectedElement,
} from "./editor-selection-mutations.js";
import type { IconElement, Project, ShapeElement, TextElement } from "@screenshot-studio/core/model";

const validShapePatch: ElementPatchFor<"shape"> = { fill: "#123456" };
// @ts-expect-error text elements do not expose shape fill
const invalidTextPatch: ElementPatchFor<"text"> = { fill: "#123456" };
// @ts-expect-error icon elements do not expose media crop
const invalidIconPatch: ElementPatchFor<"icon"> = { crop: { x: 0.5, y: 0.5, zoom: 1 } };
void [validShapePatch, invalidTextPatch, invalidIconPatch];

// @ts-expect-error the primary store action rejects shape fields for a text request
editorStore.getState().patchElement({ id: "headline", type: "text", patch: { fill: "#123456" } });

function patchText(id: string, patch: ElementPatchFor<"text">, screenId?: string) {
  editorStore.getState().patchElement({ id, type: "text", patch, screenId });
}

function patchShape(id: string, patch: ElementPatchFor<"shape">, screenId?: string) {
  editorStore.getState().patchElement({ id, type: "shape", patch, screenId });
}

function patchImage(id: string, patch: ElementPatchFor<"image">, screenId?: string) {
  editorStore.getState().patchElement({ id, type: "image", patch, screenId });
}

function patchIcon(id: string, patch: ElementPatchFor<"icon">, screenId?: string) {
  editorStore.getState().patchElement({ id, type: "icon", patch, screenId });
}

function patchGroup(id: string, patch: ElementPatchFor<"group">, screenId?: string) {
  editorStore.getState().patchElement({ id, type: "group", patch, screenId });
}

function project(): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
    mode: "isolated",
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#000000" },
        elements: [{
          id: "headline", type: "text", x: 40, y: 100, width: 580, height: 200,
          rotation: 0, opacity: 1, locked: false, visible: true,
          content: "Hello", fontFamily: "Pacifico", size: 72, weight: 400,
          lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
        }],
      },
      {
        id: "second", name: "Second", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
        artboard: { width: 660, height: 1434 },
        background: { type: "solid", color: "#111111" },
        elements: [],
      },
    ],
  };
}

describe("editorStore", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [] });
  });

  it("load sets the project and the first screen as active", () => {
    editorStore.getState().load(project());
    const s = editorStore.getState();
    expect(s.project?.meta.name).toBe("T");
    expect(s.activeScreenId).toBe("hero");
    expect(s.selectedItems).toEqual([]);
  });

  it("select sets the selected id", () => {
    editorStore.getState().load(project());
    editorStore.getState().select("headline");
    expect(editorStore.getState().selectedItems).toEqual([{ screenId: "hero", elementId: "headline" }]);
  });

  it("patchElement updates geometry immutably (new project reference)", () => {
    editorStore.getState().load(project());
    const before = editorStore.getState().project!;
    patchText("headline", { x: 123, y: 456 });
    const after = editorStore.getState().project!;
    expect(after).not.toBe(before); // new reference — patch, not in-place mutation
    expect(after.screens[0]!.elements[0]!).toMatchObject({ x: 123, y: 456 });
    expect(before.screens[0]!.elements[0]!.x).toBe(40); // original untouched
  });

  it("patchElement ignores a request whose type does not match the located element", () => {
    editorStore.getState().load(project());
    const before = editorStore.getState();

    editorStore.getState().patchElement({
      id: "headline",
      type: "shape",
      patch: { fill: "#123456" },
    });

    const after = editorStore.getState();
    expect(after.project).toBe(before.project);
    expect(after.historyPast).toEqual(before.historyPast);
  });

  it("patchElement scopes duplicate ids to the active screen", () => {
    const duplicateIds = project();
    const duplicate = structuredClone(duplicateIds.screens[0]!.elements[0]!);
    if (duplicate.type !== "text") throw new Error("expected text fixture");
    duplicate.content = "Second screen";
    duplicateIds.screens[1]!.elements = [duplicate];
    editorStore.getState().load(duplicateIds);

    patchText("headline", { x: 222 });

    expect(editorStore.getState().project!.screens[0]!.elements[0]!.x).toBe(222);
    expect(editorStore.getState().project!.screens[1]!.elements[0]!.x).toBe(40);
  });

  it("uses an owner-aware selection for duplicate ids in connected mode", () => {
    const connected = project();
    connected.mode = "connected";
    const duplicate = structuredClone(connected.screens[0]!.elements[0]!);
    connected.screens[1]!.elements = [duplicate];
    editorStore.getState().load(connected);

    editorStore.getState().select("headline", "second");
    patchText("headline", { x: 333 });

    const state = editorStore.getState();
    expect(state).toMatchObject({
      activeScreenId: "second",
      selectedItems: [{ screenId: "second", elementId: "headline" }],
    });
    expect(state.project!.screens[0]!.elements[0]!.x).toBe(40);
    expect(state.project!.screens[1]!.elements[0]!.x).toBe(333);
  });

  it("applies valid type-specific patches at the typed boundary", () => {
    const text = structuredClone(project().screens[0]!.elements[0]!) as TextElement;
    const shape: ShapeElement = {
      id: "shape", type: "shape", x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#000000", radius: 0,
    };
    const icon: IconElement = {
      id: "icon", type: "icon", x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      icon: "star", color: "#000000", strokeWidth: 2,
    };

    applyElementPatch(text, { content: "Updated" });
    applyElementPatch(shape, { fill: "#123456" });
    applyElementPatch(icon, { icon: "heart" });

    expect(text.content).toBe("Updated");
    expect(shape.fill).toBe("#123456");
    expect(icon.icon).toBe("heart");
  });
});

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
    const before = editorStore.getState().project!.screens.length;
    editorStore.getState().addScreen();
    const screens = editorStore.getState().project!.screens;
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
    const screens = editorStore.getState().project!.screens;
    const added = screens[screens.length - 1]!;
    expect(added).toMatchObject({
      name: "Untitled",
      platform: "apple",
      device: "iphone",
      locale: "en",
      artboard: { width: 660, height: 1434 },
      elements: [],
    });
    expect(added.id).not.toBe("hero");
    expect(editorStore.getState().activeScreenId).toBe(added.id);
  });

  it("creates an independent target variant without leaving the active screen", () => {
    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    const created = editorStore.getState();
    const variant = created.project!.screens.find((screen) => screen.storeTargetId === "6.5")!;
    expect(variant).toMatchObject({ variantOf: "hero", artboard: { width: 1284, height: 2778 } });
    expect(created.project!.screens[0]!.artboard).toEqual({ width: 660, height: 1434 });
    expect(created.activeScreenId).toBe("hero");

    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    expect(editorStore.getState().project!.screens.filter((screen) => screen.storeTargetId === "6.5")).toHaveLength(1);
    expect(editorStore.getState().activeScreenId).toBe("hero");

    editorStore.getState().selectScreen(variant.id);
    expect(editorStore.getState().activeScreenId).toBe(variant.id);

    editorStore.getState().removeStoreTargetVariant("hero", "6.5");
    expect(editorStore.getState().project!.screens).toHaveLength(2);
    expect(editorStore.getState().activeScreenId).toBe("hero");
  });

  it("creates and selects an independent store-output family without changing the source", () => {
    editorStore.getState().ensureStoreOutputFamily("windows", "desktop", {
      id: "4k", label: "Windows desktop 4K", width: 3840, height: 2160, orientation: "landscape",
    });
    const created = editorStore.getState();
    const windowsRoots = created.project!.screens.filter((screen) => screen.platform === "windows");
    expect(windowsRoots).toHaveLength(2);
    expect(windowsRoots.every((screen) =>
      screen.device === "desktop"
      && screen.variantOf === undefined
      && screen.artboard.width === 3840
      && screen.artboard.height === 2160
    )).toBe(true);
    expect(created.project!.screens.find((screen) => screen.id === "hero")!.artboard).toEqual({ width: 660, height: 1434 });
    expect(created.activeScreenId).toBe(windowsRoots[0]!.id);

    editorStore.getState().ensureStoreOutputFamily("windows", "desktop", {
      id: "4k", label: "Windows desktop 4K", width: 3840, height: 2160, orientation: "landscape",
    });
    expect(editorStore.getState().project!.screens.filter((screen) => screen.platform === "windows")).toHaveLength(2);
  });

  it("reorders variants only inside the visible platform/device target layer", () => {
    const current = editorStore.getState().project!;
    const heroVariant: Project["screens"][number] = {
      ...structuredClone(current.screens[0]!),
      id: "hero-65",
      platform: "apple",
      device: "iphone",
      variantOf: "hero",
      storeTargetId: "6.5",
    };
    const secondVariant: Project["screens"][number] = {
      ...structuredClone(current.screens[1]!),
      id: "second-65",
      platform: "apple",
      device: "iphone",
      variantOf: "second",
      storeTargetId: "6.5",
    };
    const ipadRoot: Project["screens"][number] = {
      ...structuredClone(current.screens[0]!),
      id: "ipad-root",
      platform: "apple",
      device: "ipad",
    };
    const ipadVariant: Project["screens"][number] = {
      ...structuredClone(ipadRoot),
      id: "ipad-65",
      platform: "apple",
      device: "ipad",
      variantOf: "ipad-root",
      storeTargetId: "6.5",
    };
    editorStore.getState().replaceProject({
      ...current,
      screens: [current.screens[0]!, current.screens[1]!, heroVariant, ipadRoot, ipadVariant, secondVariant],
    });

    editorStore.getState().reorderScreens("hero-65", "second-65");

    expect(editorStore.getState().project!.screens.map((screen) => screen.id)).toEqual([
      "hero", "second", "second-65", "ipad-root", "ipad-65", "hero-65",
    ]);
  });

  it("removeScreen deletes and reassigns active when the active screen goes", () => {
    editorStore.getState().removeScreen("hero"); // hero was active
    const screens = editorStore.getState().project!.screens;
    expect(screens.map((s) => s.id)).toEqual(["second"]);
    expect(editorStore.getState().activeScreenId).toBe("second");
  });

  it("removeScreen is a no-op on the last remaining screen", () => {
    editorStore.getState().removeScreen("second");
    editorStore.getState().removeScreen("hero"); // now the only one
    expect(editorStore.getState().project!.screens.map((s) => s.id)).toEqual(["hero"]);
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
    const active = editorStore.getState().project!.screens
      .find((screen) => screen.id === editorStore.getState().activeScreenId);
    expect(active?.locale).toBe("ar");
  });

  it("adds an RTL locale with fresh ids and makes it active", () => {
    editorStore.getState().addLocale("en", "ar", "rtl");
    const state = editorStore.getState();
    const arabic = state.project!.screens.filter((screen) => screen.locale === "ar");

    expect(state.project!.locales).toEqual(["en", "ar"]);
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
    expect(editorStore.getState().project!.screens
      .filter((screen) => screen.locale === "ar")
      .every((screen) => screen.direction === "ltr")).toBe(true);

    editorStore.getState().removeLocale("ar");
    expect(editorStore.getState().project!.locales).toEqual(["en"]);
    expect(editorStore.getState().activeScreenId).toBe("hero");
  });

  it("reorders locale screens by id without moving other locale slots", () => {
    editorStore.getState().addLocale("en", "ar", "ltr");
    const current = editorStore.getState().project!;
    const [enFirst, enSecond] = current.screens.filter((screen) => screen.locale === "en");
    const [arFirst, arSecond] = current.screens.filter((screen) => screen.locale === "ar");
    editorStore.getState().replaceProject({
      ...current,
      screens: [enFirst!, arFirst!, enSecond!, arSecond!],
    });

    editorStore.getState().reorderScreens(arFirst!.id, arSecond!.id);

    expect(editorStore.getState().project!.screens.map((screen) => screen.id)).toEqual([
      enFirst!.id,
      arSecond!.id,
      enSecond!.id,
      arFirst!.id,
    ]);
  });

  it("keeps screen selection in the active locale after an interleaved deletion", () => {
    editorStore.getState().addLocale("en", "ar", "ltr");
    const current = editorStore.getState().project!;
    const [enFirst, enSecond] = current.screens.filter((screen) => screen.locale === "en");
    const [arFirst, arSecond] = current.screens.filter((screen) => screen.locale === "ar");
    editorStore.getState().replaceProject({
      ...current,
      screens: [enFirst!, arFirst!, enSecond!, arSecond!],
    });
    editorStore.getState().selectScreen(enFirst!.id);

    editorStore.getState().removeScreen(enFirst!.id);

    expect(editorStore.getState().activeScreenId).toBe(enSecond!.id);
  });

  it("protects the final screen in a locale from screen-level removal", () => {
    editorStore.getState().addLocale("en", "ar", "rtl");
    const arabic = editorStore.getState().project!.screens
      .filter((screen) => screen.locale === "ar");
    editorStore.getState().removeScreen(arabic[1]!.id);
    const remaining = editorStore.getState().project!.screens
      .find((screen) => screen.locale === "ar")!;

    editorStore.getState().removeScreen(remaining.id);

    expect(editorStore.getState().project!.screens
      .filter((screen) => screen.locale === "ar"))
      .toEqual([remaining]);
    expect(editorStore.getState().project!.locales).toContain("ar");
  });
});

describe("editorStore elements (slice 4)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [] });
    editorStore.getState().load(project());
    // give the active screen a second element so reorder is observable
    editorStore.setState((s) => {
      const p = structuredClone(s.project!);
      p.screens[0]!.elements.push({
        id: "accent", type: "shape", x: 0, y: 0, width: 100, height: 100,
        rotation: 0, opacity: 1, locked: false, visible: true,
        kind: "rect", fill: "#FF0000", radius: 0,
      } as never);
      return { project: p };
    });
  });

  it("reorderElements changes z-order (array order)", () => {
    expect(editorStore.getState().project!.screens[0]!.elements.map((e) => e.id))
      .toEqual(["headline", "accent"]);
    editorStore.getState().reorderElements(0, 1);
    expect(editorStore.getState().project!.screens[0]!.elements.map((e) => e.id))
      .toEqual(["accent", "headline"]);
  });

  it("removeElement drops the element and clears matching selection", () => {
    editorStore.getState().select("accent");
    editorStore.getState().removeElement("accent");
    expect(editorStore.getState().project!.screens[0]!.elements.map((e) => e.id))
      .toEqual(["headline"]);
    expect(editorStore.getState().selectedItems).toEqual([]);
  });

  it("patchElement can set locked, visible and name", () => {
    patchText("headline", { locked: true, visible: false, name: "Big" });
    const el = editorStore.getState().project!.screens[0]!.elements
      .find((e) => e.id === "headline")!;
    expect(el).toMatchObject({ locked: true, visible: false, name: "Big" });
  });
});

describe("editorStore addElement + wide patch (slice 5)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedItems: [] });
    editorStore.getState().load(project());
  });

  it("addElement appends to the active screen and selects it", () => {
    const el = {
      id: "new-shape", type: "shape", x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#00FF00", radius: 0,
    } as const;
    editorStore.getState().addElement(el);
    const screen = editorStore.getState().project!.screens[0]!;
    expect(screen.elements.map((e) => e.id)).toContain("new-shape");
    expect(editorStore.getState().selectedItems).toEqual([{ screenId: "hero", elementId: "new-shape" }]);
  });

  it("patchElement can set type-specific fields", () => {
    patchText("headline", {
      color: "#123456", size: 99, align: "center", opacity: 0.5,
    });
    const el = editorStore.getState().project!.screens[0]!.elements
      .find((e) => e.id === "headline")! as { color: string; size: number; align: string; opacity: number };
    expect(el).toMatchObject({ color: "#123456", size: 99, align: "center", opacity: 0.5 });
  });

  it("patches and clears strict text shadow and shape paint", () => {
    patchText("headline", {
      shadow: { color: "#000000", blur: 8, offsetX: 1, offsetY: 3, opacity: 0.5 },
    });
    expect(editorStore.getState().project!.screens[0]!.elements[0]).toHaveProperty("shadow.blur", 8);
    patchText("headline", { shadow: null });
    expect(editorStore.getState().project!.screens[0]!.elements[0]).not.toHaveProperty("shadow");

    editorStore.getState().addElement({
      id: "styled-shape", type: "shape", x: 0, y: 0, width: 100, height: 80,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#123456", radius: 0,
    });
    patchShape("styled-shape", {
      kind: "ellipse",
      gradient: { from: "#000000", to: "#FFFFFF", angle: 90 },
      stroke: { color: "#FF00FF", width: 4 },
    });
    const shape = editorStore.getState().project!.screens[0]!.elements.find((item) => item.id === "styled-shape");
    expect(shape).toMatchObject({ kind: "ellipse", gradient: { angle: 90 }, stroke: { width: 4 } });
    patchShape("styled-shape", { gradient: null, stroke: null });
    expect(editorStore.getState().project!.screens[0]!.elements.find((item) => item.id === "styled-shape"))
      .not.toHaveProperty("gradient");
  });

  it("patches and resets decorative-image crop with the other media fields", () => {
    editorStore.getState().addElement({
      id: "decor", type: "image", x: 10, y: 20, width: 100, height: 80,
      rotation: 0, opacity: 1, locked: false, visible: true,
      assetUrl: "assets/old.png", fit: "contain", cornerRadius: 0,
    });
    patchImage("decor", {
      assetUrl: "assets/new.png", fit: "cover", cornerRadius: 18,
      crop: { x: 0.25, y: 0.75, zoom: 2 },
    });
    expect(editorStore.getState().project!.screens[0]!.elements.at(-1)).toMatchObject({
      type: "image", assetUrl: "assets/new.png", fit: "cover", cornerRadius: 18,
      crop: { x: 0.25, y: 0.75, zoom: 2 },
    });
    patchImage("decor", { crop: null });
    expect(editorStore.getState().project!.screens[0]!.elements.at(-1))
      .not.toHaveProperty("crop");
  });

  it("patches icon identity, colour, and stroke width", () => {
    editorStore.getState().addElement({
      id: "icon", type: "icon", x: 10, y: 20, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      icon: "star", color: "#3B82F6", strokeWidth: 2,
    });
    patchIcon("icon", {
      icon: "heart", color: "#FF0000", strokeWidth: 5,
    });
    expect(editorStore.getState().project!.screens[0]!.elements.at(-1)).toMatchObject({
      type: "icon", icon: "heart", color: "#FF0000", strokeWidth: 5,
    });
  });

  it("applies a font family and weight in one project patch", () => {
    patchText("headline", { fontFamily: "Inter", weight: 700 });
    const element = editorStore.getState().project!.screens[0]!.elements[0]!;
    expect(element).toMatchObject({ fontFamily: "Inter", weight: 700 });
  });

  it("replaces font assets without resetting selection", () => {
    editorStore.getState().select("headline");
    editorStore.getState().replaceFonts([
      { family: "Inter", weight: 400, source: "uploaded", path: "assets/fonts/inter-400.ttf" },
    ]);
    expect(editorStore.getState().project!.fonts).toHaveLength(1);
    expect(editorStore.getState().selectedItems).toEqual([{ screenId: "hero", elementId: "headline" }]);
  });

  it("patchElement ignores fields that do not belong to the element type", () => {
    const text = structuredClone(editorStore.getState().project!.screens[0]!.elements
      .find((element) => element.id === "headline"));
    if (!text || text.type !== "text") throw new Error("expected text fixture");
    applyElementPatch(text, {
      color: "#abcdef",
      fill: "#ff0000", // shape-only — must not land on text
    } as ElementPatchFor<"text">);
    expect(text).toMatchObject({ type: "text", color: "#abcdef" });
    expect(text).not.toHaveProperty("fill");
  });

  it("sets and clears an optional theme role", () => {
    patchText("headline", { role: "heading" });
    expect(editorStore.getState().project!.screens[0]!.elements[0]).toMatchObject({ role: "heading" });
    patchText("headline", { role: null });
    expect(editorStore.getState().project!.screens[0]!.elements[0]).not.toHaveProperty("role");
  });

  it("replaces a durable project while preserving valid active and selected ids", () => {
    editorStore.getState().select("headline");
    const next = structuredClone(editorStore.getState().project!);
    const headline = next.screens[0]!.elements[0]!;
    if (headline.type === "text") headline.color = "#123456";
    editorStore.getState().replaceProject(next);
    expect(editorStore.getState()).toMatchObject({
      activeScreenId: "hero",
      selectedItems: [{ screenId: "hero", elementId: "headline" }],
    });
    expect(editorStore.getState().project!.screens[0]!.elements[0]).toMatchObject({ color: "#123456" });
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
    const bg = editorStore.getState().project!.screens[0]!.background;
    expect(bg).toEqual({ type: "linear-gradient", from: "#ABCDEF", to: "#123456", angle: 45 });
  });

  it("resizeArtboard updates the active root and scales its composition", () => {
    editorStore.getState().resizeArtboard({ width: 1320, height: 2868 });
    expect(editorStore.getState().project!.screens[0]!.artboard)
      .toEqual({ width: 1320, height: 2868 });
    expect(editorStore.getState().project!.screens[0]!.elements[0])
      .toMatchObject({ x: 80, y: 200, width: 1160, height: 400, size: 144 });
  });

  it("resizeArtboard updates every master screen in the active output set", () => {
    editorStore.getState().resizeArtboard({ width: 1320, height: 2868 });
    expect(editorStore.getState().project!.screens[1]!.artboard)
      .toEqual({ width: 1320, height: 2868 });
  });

  it("does not let exact store-target variants drift through artboard patches", () => {
    editorStore.getState().ensureStoreTargetVariant({
      id: "6.5", label: "6.5 inch", width: 1284, height: 2778, orientation: "portrait",
    });
    const variant = editorStore.getState().project!.screens.find(
      (screen) => screen.storeTargetId === "6.5",
    )!;
    editorStore.getState().selectScreen(variant.id);
    editorStore.getState().resizeArtboard({ width: 720, height: 1560 });
    const active = editorStore.getState().project!.screens.find(
      (screen) => screen.id === editorStore.getState().activeScreenId,
    );
    expect(active?.artboard).toEqual({ width: 1284, height: 2778 });
  });
});

describe("editorStore history (phase 6 slice 4)", () => {
  beforeEach(() => {
    editorStore.getState().load(project());
  });

  it("coalesces consecutive element patches and supports undo/redo", () => {
    patchText("headline", { x: 120 });
    patchText("headline", { x: 240 });
    expect(editorStore.getState().historyPast).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().project!.screens[0]!.elements[0]!.x).toBe(40);
    expect(editorStore.getState().historyFuture).toHaveLength(1);

    editorStore.getState().redo();
    expect(editorStore.getState().project!.screens[0]!.elements[0]!.x).toBe(240);
  });

  it("starts a new undo step after an explicit history boundary", () => {
    patchText("headline", { x: 120 });
    editorStore.getState().endHistoryGroup();
    patchText("headline", { y: 220 });
    expect(editorStore.getState().historyPast).toHaveLength(2);

    editorStore.getState().undo();
    expect(editorStore.getState().project!.screens[0]!.elements[0]).toMatchObject({ x: 120, y: 100 });
  });

  it("clears redo after a new mutation and resets history on load/replace", () => {
    patchText("headline", { x: 120 });
    editorStore.getState().undo();
    expect(editorStore.getState().historyFuture).toHaveLength(1);
    patchText("headline", { y: 220 });
    expect(editorStore.getState().historyFuture).toHaveLength(0);

    editorStore.getState().load(project());
    expect(editorStore.getState().historyPast).toHaveLength(0);
    patchText("headline", { x: 300 });
    editorStore.getState().replaceProject(structuredClone(editorStore.getState().project!));
    expect(editorStore.getState()).toMatchObject({ historyPast: [], historyFuture: [] });
  });

  it("bounds history and does not record transient selection", () => {
    editorStore.getState().select("headline", "hero");
    editorStore.getState().selectScreen("second");
    expect(editorStore.getState().historyPast).toHaveLength(0);

    editorStore.getState().selectScreen("hero");
    for (let index = 0; index < 60; index += 1) {
      patchText("headline", { x: index });
      editorStore.getState().endHistoryGroup();
    }
    expect(editorStore.getState().historyPast).toHaveLength(50);
  });

  it("clears an invalid selection when undo removes the selected element", () => {
    editorStore.getState().addElement({
      id: "temporary", type: "shape", x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#00FF00", radius: 0,
    });
    expect(editorStore.getState()).toMatchObject({
      selectedItems: [{ screenId: "hero", elementId: "temporary" }],
    });
    editorStore.getState().undo();
    expect(editorStore.getState().selectedItems).toEqual([]);
  });
});

describe("editorStore connected workspace hardening (phase 6 slice 7)", () => {
  it("records a successful canvas-mode change and makes it undoable", () => {
    editorStore.getState().load(project());
    editorStore.getState().setCanvasMode("connected");
    expect(editorStore.getState().project?.mode).toBe("connected");
    expect(editorStore.getState().historyPast).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().project?.mode).toBe("isolated");
  });

  it("refuses a lossy isolated switch without changing history", () => {
    const connected = project();
    connected.mode = "connected";
    connected.screens[0]!.elements[0]!.x = 100;
    editorStore.getState().load(connected);

    expect(() => editorStore.getState().setCanvasMode("isolated")).toThrow(/crosses its owner artboard/);
    expect(editorStore.getState().project?.mode).toBe("connected");
    expect(editorStore.getState().historyPast).toHaveLength(0);
  });

  it("reorders only exact connected-group slots", () => {
    const connected = project();
    connected.mode = "connected";
    connected.platforms = ["apple", "android"];
    const unrelated: Project["screens"][number] = {
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
    connected.screens = [connected.screens[0]!, unrelated, connected.screens[1]!];
    editorStore.getState().load(connected);

    editorStore.getState().reorderScreens("hero", "second");
    expect(editorStore.getState().project!.screens.map((screen) => screen.id))
      .toEqual(["second", "unrelated", "hero"]);
  });
});

describe("editorStore multi-selection (phase 7 slice 1)", () => {
  beforeEach(() => {
    const connected = project();
    connected.mode = "connected";
    const duplicate = structuredClone(connected.screens[0]!.elements[0]!);
    duplicate.locked = true;
    connected.screens[1]!.elements = [duplicate];
    editorStore.getState().load(connected);
  });

  it("toggles owner-aware duplicate ids and keeps the last item primary", () => {
    editorStore.getState().select("headline", "hero");
    editorStore.getState().select("headline", "second", "toggle");
    expect(editorStore.getState().selectedItems).toEqual([
      { screenId: "hero", elementId: "headline" },
      { screenId: "second", elementId: "headline" },
    ]);

    editorStore.getState().select("headline", "hero", "toggle");
    expect(editorStore.getState().selectedItems).toEqual([
      { screenId: "second", elementId: "headline" },
    ]);
  });

  it("indexes structured selections by owner screen", () => {
    const index = createSelectedElementIndex([
      { screenId: "hero", elementId: "headline" },
      { screenId: "hero", elementId: "nested" },
      { screenId: "second", elementId: "headline" },
    ]);

    expect([...index.get("hero")!]).toEqual(["headline", "nested"]);
    expect([...index.get("second")!]).toEqual(["headline"]);
  });

  it("traverses selected top-level elements and group children with owner disambiguation", () => {
    const fixture = structuredClone(editorStore.getState().project!);
    const child = structuredClone(fixture.screens[0]!.elements[0]!) as TextElement;
    child.id = "nested";
    fixture.screens[0]!.elements.push({
      id: "hero-group", type: "group", x: 0, y: 0, width: 580, height: 200,
      rotation: 0, opacity: 1, locked: false, visible: true, children: [child],
    });
    const secondChild = structuredClone(child);
    fixture.screens[1]!.elements.push({
      id: "second-group", type: "group", x: 0, y: 0, width: 580, height: 200,
      rotation: 0, opacity: 1, locked: false, visible: true, children: [secondChild],
    });

    const visited: string[] = [];
    forEachSelectedElement(fixture, [
      { screenId: "hero", elementId: "nested" },
      { screenId: "second", elementId: "headline" },
    ], ({ screen, element, parent }) => {
      visited.push(`${screen.id}:${parent?.id ?? "root"}:${element.id}`);
    });

    expect(visited).toEqual([
      "hero:hero-group:nested",
      "second:root:headline",
    ]);
  });

  it("moves every unlocked selected owner in one undoable mutation", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "second", elementId: "headline" },
    ]);
    editorStore.getState().moveSelected({ x: 15, y: -5 });

    const [first, second] = editorStore.getState().project!.screens;
    expect(first!.elements[0]).toMatchObject({ x: 55, y: 95 });
    expect(second!.elements[0]).toMatchObject({ x: 40, y: 100 });
    expect(editorStore.getState().historyPast).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().project!.screens[0]!.elements[0]).toMatchObject({ x: 40, y: 100 });
  });

  it("locks and hides the complete selection atomically", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "second", elementId: "headline" },
    ]);
    editorStore.getState().setSelectedLocked(true);
    expect(editorStore.getState().project!.screens.every((screen) => screen.elements[0]!.locked)).toBe(true);
    expect(editorStore.getState().selectedItems).toHaveLength(2);

    editorStore.getState().setSelectedVisible(false);
    expect(editorStore.getState().project!.screens.every((screen) => !screen.elements[0]!.visible)).toBe(true);
    expect(editorStore.getState().selectedItems).toEqual([]);
    expect(editorStore.getState().historyPast).toHaveLength(2);
  });

  it("deletes duplicate ids from both owners in one undo step", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "second", elementId: "headline" },
    ]);
    editorStore.getState().removeSelected();
    expect(editorStore.getState().project!.screens.every((screen) => screen.elements.length === 0)).toBe(true);
    expect(editorStore.getState().selectedItems).toEqual([]);
    expect(editorStore.getState().historyPast).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().project!.screens.every((screen) => screen.elements.length === 1)).toBe(true);
    expect(editorStore.getState().selectedItems).toEqual([]);
  });

  it("reconciles connected selection when switching to isolated mode", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "second", elementId: "headline" },
    ]);
    editorStore.getState().setCanvasMode("isolated");
    expect(editorStore.getState().selectedItems).toEqual([
      { screenId: "hero", elementId: "headline" },
    ]);
  });
});

describe("editorStore group authoring (phase 7 slice 3)", () => {
  beforeEach(() => {
    const fixture = project();
    fixture.screens[0]!.elements.push({
      id: "card", type: "shape", x: 100, y: 340, width: 200, height: 120,
      rotation: 0, opacity: 1, locked: false, visible: true,
      kind: "rect", fill: "#3366FF", radius: 12,
    });
    editorStore.getState().load(fixture);
  });

  it("groups top-level leaves from one owner and restores them through undo", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "hero", elementId: "card" },
    ]);
    editorStore.getState().groupSelected();

    const state = editorStore.getState();
    const group = state.project!.screens[0]!.elements[0]!;
    expect(group.type).toBe("group");
    if (group.type !== "group") throw new Error("expected group");
    expect(group.children.map((child) => child.id)).toEqual(["headline", "card"]);
    expect(state.selectedItems).toEqual([{ screenId: "hero", elementId: group.id }]);
    expect(state.historyPast).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().project!.screens[0]!.elements.map((element) => element.id))
      .toEqual(["headline", "card"]);
  });

  it("does not group selections from different owner screens", () => {
    const loaded = structuredClone(editorStore.getState().project!);
    const secondShape = structuredClone(loaded.screens[0]!.elements[1]!);
    secondShape.id = "second-card";
    loaded.screens[1]!.elements.push(secondShape);
    editorStore.getState().load(loaded);
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "second", elementId: "second-card" },
    ]);

    editorStore.getState().groupSelected();

    expect(editorStore.getState().project).toBe(loaded);
    expect(editorStore.getState().historyPast).toEqual([]);
  });

  it("patches nested children and removes an empty group", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "hero", elementId: "card" },
    ]);
    editorStore.getState().groupSelected();
    patchShape("card", { fill: "#FF0000", x: 25 }, "hero");

    const group = editorStore.getState().project!.screens[0]!.elements[0]!;
    expect(group.type === "group" && group.children[1]).toMatchObject({ fill: "#FF0000", x: 25 });

    editorStore.getState().removeElement("headline", "hero");
    editorStore.getState().removeElement("card", "hero");
    expect(editorStore.getState().project!.screens[0]!.elements).toEqual([]);
  });

  it("resizes uniformly and scales child geometry", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "hero", elementId: "card" },
    ]);
    editorStore.getState().groupSelected();
    const group = editorStore.getState().project!.screens[0]!.elements[0]!;
    if (group.type !== "group") throw new Error("expected group");
    const before = structuredClone(group);

    patchGroup(group.id, { width: group.width * 2 }, "hero");

    const resized = editorStore.getState().project!.screens[0]!.elements[0]!;
    if (resized.type !== "group") throw new Error("expected group");
    expect(resized).toMatchObject({ width: before.width * 2, height: before.height * 2 });
    expect(resized.children[0]).toMatchObject({
      width: before.children[0]!.width * 2,
      height: before.children[0]!.height * 2,
    });
    expect(resized.children[0]!.type === "text" && resized.children[0]!.size)
      .toBe(before.children[0]!.type === "text" ? before.children[0]!.size * 2 : undefined);
  });

  it("duplicates groups with fresh ids, then ungroups the copy", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "hero", elementId: "card" },
    ]);
    editorStore.getState().groupSelected();
    const original = editorStore.getState().project!.screens[0]!.elements[0]!;
    if (original.type !== "group") throw new Error("expected group");

    editorStore.getState().duplicateSelected();
    const elements = editorStore.getState().project!.screens[0]!.elements;
    expect(elements).toHaveLength(2);
    const copy = elements[1]!;
    if (copy.type !== "group") throw new Error("expected copied group");
    expect(copy.id).not.toBe(original.id);
    expect(copy.children.map((child) => child.id)).not.toEqual(original.children.map((child) => child.id));
    expect(copy).toMatchObject({ x: original.x + 20, y: original.y + 20 });
    expect(editorStore.getState().selectedItems).toEqual([{ screenId: "hero", elementId: copy.id }]);

    patchGroup(copy.id, { rotation: 30, opacity: 0.5 }, "hero");
    editorStore.getState().ungroupSelected();
    const ungrouped = editorStore.getState().project!.screens[0]!.elements.slice(1);
    expect(ungrouped).toHaveLength(2);
    expect(ungrouped[0]).toMatchObject({
      rotation: copy.children[0]!.rotation + 30,
      opacity: copy.children[0]!.opacity * 0.5,
    });
    expect(editorStore.getState().selectedItems.map((item) => item.elementId))
      .toEqual(copy.children.map((child) => child.id));
  });
});
