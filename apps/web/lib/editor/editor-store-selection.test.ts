// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from "vitest";
import { editorStore } from "./editor-store.js";
import { applyElementPatch, type ElementPatchFor } from "./editor-element-patch.js";
import {
  createSelectedElementIndex,
  forEachSelectedElement,
} from "./editor-selection-mutations.js";
import { parseProject, type TextElement } from "@screenshot-studio/core/model";
import {
  patchGroup,
  patchIcon,
  patchImage,
  patchShape,
  patchText,
  project,
} from "./editor-store-test-fixtures.js";

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
    const screen = editorStore.getState().project!.layouts[0]!.screens[0]!;
    expect(screen.elements.map((e) => e.id)).toContain("new-shape");
    expect(editorStore.getState().selectedItems).toEqual([{ screenId: "hero", elementId: "new-shape" }]);
  });

  it("patchElement can set type-specific fields", () => {
    patchText("headline", {
      color: "#123456", size: 99, align: "center", opacity: 0.5,
    });
    const el = editorStore.getState().project!.layouts[0]!.screens[0]!.elements
      .find((e) => e.id === "headline")! as { color: string; size: number; align: string; opacity: number };
    expect(el).toMatchObject({ color: "#123456", size: 99, align: "center", opacity: 0.5 });
  });

  it("patches and clears strict text shadow and shape paint", () => {
    patchText("headline", {
      shadow: { color: "#000000", blur: 8, offsetX: 1, offsetY: 3, opacity: 0.5 },
    });
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]).toHaveProperty("shadow.blur", 8);
    patchText("headline", { shadow: null });
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]).not.toHaveProperty("shadow");

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
    const shape = editorStore.getState().project!.layouts[0]!.screens[0]!.elements.find((item) => item.id === "styled-shape");
    expect(shape).toMatchObject({ kind: "ellipse", gradient: { angle: 90 }, stroke: { width: 4 } });
    patchShape("styled-shape", { gradient: null, stroke: null });
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements.find((item) => item.id === "styled-shape"))
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
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements.at(-1)).toMatchObject({
      type: "image", assetUrl: "assets/new.png", fit: "cover", cornerRadius: 18,
      crop: { x: 0.25, y: 0.75, zoom: 2 },
    });
    patchImage("decor", { crop: null });
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements.at(-1))
      .not.toHaveProperty("crop");
  });

  it("patches and clears decorative-image blur", () => {
    editorStore.getState().addElement({
      id: "decor", type: "image", x: 10, y: 20, width: 100, height: 80,
      rotation: 0, opacity: 1, locked: false, visible: true,
      assetUrl: "assets/old.png", fit: "contain", cornerRadius: 0,
    });

    patchImage("decor", { blur: 12 });
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements.at(-1))
      .toHaveProperty("blur", 12);
    patchImage("decor", { blur: null });
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements.at(-1))
      .not.toHaveProperty("blur");
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
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements.at(-1)).toMatchObject({
      type: "icon", icon: "heart", color: "#FF0000", strokeWidth: 5,
    });
  });

  it("applies a font family and weight in one project patch", () => {
    patchText("headline", { fontFamily: "Inter", weight: 700 });
    const element = editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!;
    expect(element).toMatchObject({ fontFamily: "Inter", weight: 700 });
  });

  it("preserves valid selection while accepting an authoritative font project", () => {
    editorStore.getState().select("headline");
    editorStore.getState().replaceProject({
      ...editorStore.getState().project!,
      fonts: [
        { family: "Inter", weight: 400, source: "uploaded", path: "assets/fonts/inter-400.ttf" },
      ],
    });
    expect(editorStore.getState().project!.fonts).toHaveLength(1);
    expect(editorStore.getState().selectedItems).toEqual([{ screenId: "hero", elementId: "headline" }]);
  });

  it("patchElement ignores fields that do not belong to the element type", () => {
    const text = structuredClone(editorStore.getState().project!.layouts[0]!.screens[0]!.elements
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
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]).toMatchObject({ role: "heading" });
    patchText("headline", { role: null });
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]).not.toHaveProperty("role");
  });

  it("replaces a durable project while preserving valid active and selected ids", () => {
    editorStore.getState().select("headline");
    const next = structuredClone(editorStore.getState().project!);
    const headline = next.layouts[0]!.screens[0]!.elements[0]!;
    if (headline.type === "text") headline.color = "#123456";
    editorStore.getState().replaceProject(next);
    expect(editorStore.getState()).toMatchObject({
      activeScreenId: "hero",
      selectedItems: [{ screenId: "hero", elementId: "headline" }],
    });
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]).toMatchObject({ color: "#123456" });
  });
});

describe("editorStore multi-selection (phase 7 slice 1)", () => {
  beforeEach(() => {
    const connected = project();
    connected.layouts[0]!.mode = "connected";
    const duplicate = structuredClone(connected.layouts[0]!.screens[0]!.elements[0]!);
    duplicate.locked = true;
    connected.layouts[0]!.screens[1]!.elements = [duplicate];
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
    const child = structuredClone(fixture.layouts[0]!.screens[0]!.elements[0]!) as TextElement;
    child.id = "nested";
    fixture.layouts[0]!.screens[0]!.elements.push({
      id: "hero-group", type: "group", x: 0, y: 0, width: 580, height: 200,
      rotation: 0, opacity: 1, locked: false, visible: true, children: [child],
    });
    const secondChild = structuredClone(child);
    fixture.layouts[0]!.screens[1]!.elements.push({
      id: "second-group", type: "group", x: 0, y: 0, width: 580, height: 200,
      rotation: 0, opacity: 1, locked: false, visible: true, children: [secondChild],
    });

    const visited: string[] = [];
    forEachSelectedElement(fixture.layouts[0]!, [
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

    const [first, second] = editorStore.getState().project!.layouts[0]!.screens;
    expect(first!.elements[0]).toMatchObject({ x: 55, y: 95 });
    expect(second!.elements[0]).toMatchObject({ x: 40, y: 100 });
    expect(editorStore.getState().historyPast).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]).toMatchObject({ x: 40, y: 100 });
  });

  it("locks and hides the complete selection atomically", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "second", elementId: "headline" },
    ]);
    editorStore.getState().setSelectedLocked(true);
    expect(editorStore.getState().project!.layouts[0]!.screens.every((screen) => screen.elements[0]!.locked)).toBe(true);
    expect(editorStore.getState().selectedItems).toHaveLength(2);

    editorStore.getState().setSelectedVisible(false);
    expect(editorStore.getState().project!.layouts[0]!.screens.every((screen) => !screen.elements[0]!.visible)).toBe(true);
    expect(editorStore.getState().selectedItems).toEqual([]);
    expect(editorStore.getState().historyPast).toHaveLength(2);
  });

  it("deletes duplicate ids from both owners in one undo step", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "second", elementId: "headline" },
    ]);
    editorStore.getState().removeSelected();
    expect(editorStore.getState().project!.layouts[0]!.screens.every((screen) => screen.elements.length === 0)).toBe(true);
    expect(editorStore.getState().selectedItems).toEqual([]);
    expect(editorStore.getState().historyPast).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().project!.layouts[0]!.screens.every((screen) => screen.elements.length === 1)).toBe(true);
    expect(editorStore.getState().selectedItems).toEqual([]);
  });

  it("aligns across connected owners in one undo step without moving locked layers", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "second", elementId: "headline" },
    ]);
    // The locked second headline spans stage x 700..1280 and anchors the right edge.
    editorStore.getState().arrangeSelected("right");

    const [hero, second] = editorStore.getState().project!.layouts[0]!.screens;
    expect(hero!.elements[0]).toMatchObject({ x: 700, y: 100 });
    expect(second!.elements[0]).toMatchObject({ x: 40, y: 100, locked: true });
    expect(editorStore.getState().historyPast).toHaveLength(1);
    expect(() => parseProject(editorStore.getState().project)).not.toThrow();

    editorStore.getState().arrangeSelected("right");
    expect(editorStore.getState().historyPast).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]).toMatchObject({ x: 40 });
  });

  it("refuses to arrange group children against top-level selection bounds", () => {
    const fixture = structuredClone(editorStore.getState().project!);
    const child = structuredClone(fixture.layouts[0]!.screens[0]!.elements[0]!) as TextElement;
    child.id = "nested";
    fixture.layouts[0]!.screens[0]!.elements.push({
      id: "hero-group", type: "group", x: 0, y: 0, width: 580, height: 200,
      rotation: 0, opacity: 1, locked: false, visible: true, children: [child],
    });
    editorStore.getState().load(fixture);
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "hero", elementId: "nested" },
    ]);
    const before = editorStore.getState().project;

    editorStore.getState().arrangeSelected("right");
    expect(editorStore.getState().project).toBe(before);
  });

  it("sets unlocked selection opacity as one grouped undo step", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "second", elementId: "headline" },
    ]);
    editorStore.getState().setSelectedOpacity(0.4);
    editorStore.getState().setSelectedOpacity(0.25);
    editorStore.getState().endHistoryGroup();

    const [hero, second] = editorStore.getState().project!.layouts[0]!.screens;
    expect(hero!.elements[0]!.opacity).toBe(0.25);
    expect(second!.elements[0]!.opacity).toBe(1);
    expect(editorStore.getState().historyPast).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!.opacity).toBe(1);
  });

});

describe("editorStore group authoring (phase 7 slice 3)", () => {
  beforeEach(() => {
    const fixture = project();
    fixture.layouts[0]!.screens[0]!.elements.push({
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
    const group = state.project!.layouts[0]!.screens[0]!.elements[0]!;
    expect(group.type).toBe("group");
    if (group.type !== "group") throw new Error("expected group");
    expect(group.children.map((child) => child.id)).toEqual(["headline", "card"]);
    expect(state.selectedItems).toEqual([{ screenId: "hero", elementId: group.id }]);
    expect(state.historyPast).toHaveLength(1);

    editorStore.getState().undo();
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements.map((element) => element.id))
      .toEqual(["headline", "card"]);
  });

  it("does not group selections from different owner screens", () => {
    const loaded = structuredClone(editorStore.getState().project!);
    const secondShape = structuredClone(loaded.layouts[0]!.screens[0]!.elements[1]!);
    secondShape.id = "second-card";
    loaded.layouts[0]!.screens[1]!.elements.push(secondShape);
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

    const group = editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!;
    expect(group.type === "group" && group.children[1]).toMatchObject({ fill: "#FF0000", x: 25 });

    editorStore.getState().removeElement("headline", "hero");
    editorStore.getState().removeElement("card", "hero");
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements).toEqual([]);
  });

  it("resizes uniformly and scales child geometry", () => {
    editorStore.getState().setSelection([
      { screenId: "hero", elementId: "headline" },
      { screenId: "hero", elementId: "card" },
    ]);
    editorStore.getState().groupSelected();
    const group = editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!;
    if (group.type !== "group") throw new Error("expected group");
    const before = structuredClone(group);

    patchGroup(group.id, { width: group.width * 2 }, "hero");

    const resized = editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!;
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
    const original = editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!;
    if (original.type !== "group") throw new Error("expected group");

    editorStore.getState().duplicateSelected();
    const elements = editorStore.getState().project!.layouts[0]!.screens[0]!.elements;
    expect(elements).toHaveLength(2);
    const copy = elements[1]!;
    if (copy.type !== "group") throw new Error("expected copied group");
    expect(copy.id).not.toBe(original.id);
    expect(copy.children.map((child) => child.id)).not.toEqual(original.children.map((child) => child.id));
    expect(copy).toMatchObject({ x: original.x + 20, y: original.y + 20 });
    expect(editorStore.getState().selectedItems).toEqual([{ screenId: "hero", elementId: copy.id }]);

    patchGroup(copy.id, { rotation: 30, opacity: 0.5 }, "hero");
    editorStore.getState().ungroupSelected();
    const ungrouped = editorStore.getState().project!.layouts[0]!.screens[0]!.elements.slice(1);
    expect(ungrouped).toHaveLength(2);
    expect(ungrouped[0]).toMatchObject({
      rotation: copy.children[0]!.rotation + 30,
      opacity: copy.children[0]!.opacity * 0.5,
    });
    expect(editorStore.getState().selectedItems.map((item) => item.elementId))
      .toEqual(copy.children.map((child) => child.id));
  });
});
