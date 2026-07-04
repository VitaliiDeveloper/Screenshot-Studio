import { describe, it, expect, beforeEach } from "vitest";
import { editorStore } from "./editor-store.js";
import type { Project } from "@screenshot-studio/core/model";

function project(): Project {
  return {
    meta: { name: "T", schemaVersion: 1 },
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [{
      id: "hero", name: "Hero", platform: "apple", device: "iphone", locale: "en",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#000000" },
      elements: [{
        id: "headline", type: "text", x: 40, y: 100, width: 580, height: 200,
        rotation: 0, opacity: 1, locked: false, visible: true,
        content: "Hello", fontFamily: "Pacifico", size: 72, weight: 400,
        lineHeight: 1.2, letterSpacing: 0, align: "left", color: "#FFFFFF",
      }],
    }],
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
});
