import { describe, it, expect, beforeEach } from "vitest";
import { editorStore } from "./editor-store.js";
import type { Project } from "@screenshot-studio/core/model";

function project(): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
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
    editorStore.setState({ project: null, activeScreenId: null, selectedId: null });
  });

  it("load sets the project and the first screen as active", () => {
    editorStore.getState().load(project());
    const s = editorStore.getState();
    expect(s.project?.meta.name).toBe("T");
    expect(s.activeScreenId).toBe("hero");
    expect(s.selectedId).toBeNull();
  });

  it("select sets the selected id", () => {
    editorStore.getState().load(project());
    editorStore.getState().select("headline");
    expect(editorStore.getState().selectedId).toBe("headline");
  });

  it("patchElement updates geometry immutably (new project reference)", () => {
    editorStore.getState().load(project());
    const before = editorStore.getState().project!;
    editorStore.getState().patchElement("headline", { x: 123, y: 456 });
    const after = editorStore.getState().project!;
    expect(after).not.toBe(before); // new reference — patch, not in-place mutation
    expect(after.screens[0]!.elements[0]!).toMatchObject({ x: 123, y: 456 });
    expect(before.screens[0]!.elements[0]!.x).toBe(40); // original untouched
  });

  it("patchElement scopes duplicate ids to the active screen", () => {
    const duplicateIds = project();
    const duplicate = structuredClone(duplicateIds.screens[0]!.elements[0]!);
    if (duplicate.type !== "text") throw new Error("expected text fixture");
    duplicate.content = "Second screen";
    duplicateIds.screens[1]!.elements = [duplicate];
    editorStore.getState().load(duplicateIds);

    editorStore.getState().patchElement("headline", { x: 222 });

    expect(editorStore.getState().project!.screens[0]!.elements[0]!.x).toBe(222);
    expect(editorStore.getState().project!.screens[1]!.elements[0]!.x).toBe(40);
  });
});

describe("editorStore screens (slice 4)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedId: null });
    editorStore.getState().load(project());
  });

  it("selectScreen sets active and clears selection", () => {
    editorStore.getState().select("headline");
    editorStore.getState().selectScreen("second");
    expect(editorStore.getState().activeScreenId).toBe("second");
    expect(editorStore.getState().selectedId).toBeNull();
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
    editorStore.setState({ project: null, activeScreenId: null, selectedId: null });
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

    editorStore.getState().reorderScreensInLocale(arFirst!.id, arSecond!.id);

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
    editorStore.setState({ project: null, activeScreenId: null, selectedId: null });
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
    expect(editorStore.getState().selectedId).toBeNull();
  });

  it("patchElement can set locked, visible and name", () => {
    editorStore.getState().patchElement("headline", { locked: true, visible: false, name: "Big" });
    const el = editorStore.getState().project!.screens[0]!.elements
      .find((e) => e.id === "headline")!;
    expect(el).toMatchObject({ locked: true, visible: false, name: "Big" });
  });
});

describe("editorStore addElement + wide patch (slice 5)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedId: null });
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
    expect(editorStore.getState().selectedId).toBe("new-shape");
  });

  it("patchElement can set type-specific fields", () => {
    editorStore.getState().patchElement("headline", {
      color: "#123456", size: 99, align: "center", opacity: 0.5,
    });
    const el = editorStore.getState().project!.screens[0]!.elements
      .find((e) => e.id === "headline")! as { color: string; size: number; align: string; opacity: number };
    expect(el).toMatchObject({ color: "#123456", size: 99, align: "center", opacity: 0.5 });
  });

  it("applies a font family and weight in one project patch", () => {
    editorStore.getState().patchElement("headline", { fontFamily: "Inter", weight: 700 });
    const element = editorStore.getState().project!.screens[0]!.elements[0]!;
    expect(element).toMatchObject({ fontFamily: "Inter", weight: 700 });
  });

  it("replaces font assets without resetting selection", () => {
    editorStore.getState().select("headline");
    editorStore.getState().replaceFonts([
      { family: "Inter", weight: 400, source: "uploaded", path: "assets/fonts/inter-400.ttf" },
    ]);
    expect(editorStore.getState().project!.fonts).toHaveLength(1);
    expect(editorStore.getState().selectedId).toBe("headline");
  });

  it("patchElement ignores fields that do not belong to the element type", () => {
    editorStore.getState().patchElement("headline", {
      color: "#abcdef",
      fill: "#ff0000", // shape-only — must not land on text
    });
    const el = editorStore.getState().project!.screens[0]!.elements
      .find((e) => e.id === "headline")!;
    expect(el).toMatchObject({ type: "text", color: "#abcdef" });
    expect(el).not.toHaveProperty("fill");
  });

  it("sets and clears an optional theme role", () => {
    editorStore.getState().patchElement("headline", { role: "heading" });
    expect(editorStore.getState().project!.screens[0]!.elements[0]).toMatchObject({ role: "heading" });
    editorStore.getState().patchElement("headline", { role: null });
    expect(editorStore.getState().project!.screens[0]!.elements[0]).not.toHaveProperty("role");
  });

  it("replaces a durable project while preserving valid active and selected ids", () => {
    editorStore.getState().select("headline");
    const next = structuredClone(editorStore.getState().project!);
    const headline = next.screens[0]!.elements[0]!;
    if (headline.type === "text") headline.color = "#123456";
    editorStore.getState().replaceProject(next);
    expect(editorStore.getState()).toMatchObject({ activeScreenId: "hero", selectedId: "headline" });
    expect(editorStore.getState().project!.screens[0]!.elements[0]).toMatchObject({ color: "#123456" });
  });
});

describe("editorStore screen editors (slice 5)", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeScreenId: null, selectedId: null });
    editorStore.getState().load(project());
  });

  it("patchBackground sets the active screen's solid colour", () => {
    editorStore.getState().patchBackground({ color: "#ABCDEF" });
    const bg = editorStore.getState().project!.screens[0]!.background;
    expect(bg).toMatchObject({ type: "solid", color: "#ABCDEF" });
  });

  it("patchArtboard sets the active screen's dimensions", () => {
    editorStore.getState().patchArtboard({ width: 720, height: 1560 });
    expect(editorStore.getState().project!.screens[0]!.artboard)
      .toMatchObject({ width: 720, height: 1560 });
  });

  it("patchArtboard only touches the active screen", () => {
    editorStore.getState().patchArtboard({ width: 720 });
    expect(editorStore.getState().project!.screens[1]!.artboard.width).toBe(660);
  });
});
