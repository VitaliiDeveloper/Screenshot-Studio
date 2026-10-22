// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { editorStore } from "./editor-store.js";
import { applyElementPatch, type ElementPatchFor } from "./editor-element-patch.js";
import type {
  IconElement,
  Project,
  ShapeElement,
  TextElement,
} from "@screenshot-studio/core/model";
import { patchText, project } from "./editor-store-test-fixtures.js";

const validShapePatch: ElementPatchFor<"shape"> = { fill: "#123456" };
// @ts-expect-error text elements do not expose shape fill
const invalidTextPatch: ElementPatchFor<"text"> = { fill: "#123456" };
// @ts-expect-error icon elements do not expose media crop
const invalidIconPatch: ElementPatchFor<"icon"> = { crop: { x: 0.5, y: 0.5, zoom: 1 } };
void [validShapePatch, invalidTextPatch, invalidIconPatch];

// @ts-expect-error the primary store action rejects shape fields for a text request
editorStore.getState().patchElement({ id: "headline", type: "text", patch: { fill: "#123456" } });

describe("editorStore", () => {
  beforeEach(() => {
    editorStore.setState({ project: null, activeLayoutId: null, activeScreenId: null, selectedItems: [] });
  });

  it("load sets the project and the first screen as active", () => {
    editorStore.getState().load(project());
    const s = editorStore.getState();
    expect(s.project?.meta.name).toBe("T");
    expect(s.activeScreenId).toBe("hero");
    expect(s.selectedItems).toEqual([]);
  });

  it("reloads the same project while preserving valid screen selection and resetting history", () => {
    const initial = project();
    initial.layouts[0]!.screens[1]!.elements = [structuredClone(initial.layouts[0]!.screens[0]!.elements[0]!)];
    editorStore.getState().load(initial);
    editorStore.getState().selectScreen("second");
    editorStore.getState().select("headline", "second");
    patchText("headline", { x: 120 }, "second");
    expect(editorStore.getState().historyPast.length).toBeGreaterThan(0);

    editorStore.getState().reloadProject(structuredClone(editorStore.getState().project!));

    expect(editorStore.getState()).toMatchObject({
      activeLayoutId: "default",
      activeScreenId: "second",
      selectedItems: [{ screenId: "second", elementId: "headline" }],
      historyPast: [],
      historyFuture: [],
      layoutHistories: {},
    });
  });

  it("falls back and clears stale selection when same-project context no longer exists", () => {
    editorStore.getState().load(project());
    editorStore.getState().selectScreen("second");
    const reloaded = project();
    reloaded.layouts[0]!.screens = [reloaded.layouts[0]!.screens[0]!];

    editorStore.getState().reloadProject(reloaded);

    expect(editorStore.getState().activeScreenId).toBe("hero");
    expect(editorStore.getState().selectedItems).toEqual([]);
  });

  it("resets every project-scoped editor field before another project loads", () => {
    editorStore.getState().load(project());
    patchText("headline", { x: 123 });
    editorStore.getState().select("headline");
    editorStore.getState().setSaveState("saved");
    editorStore.getState().setSaveState("error", "disk unavailable");

    (editorStore.getState() as unknown as { resetProjectState(): void }).resetProjectState();

    expect(editorStore.getState()).toMatchObject({
      project: null,
      activeLayoutId: null,
      activeScreenId: null,
      selectedItems: [],
      historyPast: [],
      historyFuture: [],
      layoutHistories: {},
      historyGroupKey: null,
      saveStatus: "idle",
      saveError: null,
      lastSavedAt: null,
    });
  });

  describe("last successful save", () => {
    afterEach(() => vi.useRealTimers());

    it("records the time of a saved state and keeps it through saving and error", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      editorStore.getState().load(project());
      expect(editorStore.getState().lastSavedAt).toBeNull();

      editorStore.getState().setSaveState("saved");
      vi.setSystemTime(5_000);
      editorStore.getState().setSaveState("saving");
      editorStore.getState().setSaveState("error", "disk unavailable");

      expect(editorStore.getState()).toMatchObject({ saveStatus: "error", lastSavedAt: 1_000 });
    });

    it("keeps the time through a same-project reload and forgets it when another project loads", () => {
      editorStore.getState().load(project());
      editorStore.getState().setSaveState("saved");
      const savedAt = editorStore.getState().lastSavedAt;
      expect(savedAt).not.toBeNull();

      editorStore.getState().reloadProject(project());
      expect(editorStore.getState().lastSavedAt).toBe(savedAt);

      editorStore.getState().load(project());
      expect(editorStore.getState().lastSavedAt).toBeNull();
    });
  });

  it("does not expose a partial durable-font replacement action", () => {
    expect(editorStore.getState()).not.toHaveProperty("replaceFonts");
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
    expect(after.layouts[0]!.screens[0]!.elements[0]!).toMatchObject({ x: 123, y: 456 });
    expect(before.layouts[0]!.screens[0]!.elements[0]!.x).toBe(40); // original untouched
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
    const duplicate = structuredClone(duplicateIds.layouts[0]!.screens[0]!.elements[0]!);
    if (duplicate.type !== "text") throw new Error("expected text fixture");
    duplicate.content = "Second screen";
    duplicateIds.layouts[0]!.screens[1]!.elements = [duplicate];
    editorStore.getState().load(duplicateIds);

    patchText("headline", { x: 222 });

    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!.x).toBe(222);
    expect(editorStore.getState().project!.layouts[0]!.screens[1]!.elements[0]!.x).toBe(40);
  });

  it("uses an owner-aware selection for duplicate ids in connected mode", () => {
    const connected = project();
    connected.layouts[0]!.mode = "connected";
    const duplicate = structuredClone(connected.layouts[0]!.screens[0]!.elements[0]!);
    connected.layouts[0]!.screens[1]!.elements = [duplicate];
    editorStore.getState().load(connected);

    editorStore.getState().select("headline", "second");
    patchText("headline", { x: 333 });

    const state = editorStore.getState();
    expect(state).toMatchObject({
      activeScreenId: "second",
      selectedItems: [{ screenId: "second", elementId: "headline" }],
    });
    expect(state.project!.layouts[0]!.screens[0]!.elements[0]!.x).toBe(40);
    expect(state.project!.layouts[0]!.screens[1]!.elements[0]!.x).toBe(333);
  });

  it("applies valid type-specific patches at the typed boundary", () => {
    const text = structuredClone(project().layouts[0]!.screens[0]!.elements[0]!) as TextElement;
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

    applyElementPatch(text, { content: "Updated", verticalAlign: "middle" });
    applyElementPatch(shape, { fill: "#123456" });
    applyElementPatch(icon, { icon: "heart" });

    expect(text.content).toBe("Updated");
    expect(text.verticalAlign).toBe("middle");
    expect(shape.fill).toBe("#123456");
    expect(icon.icon).toBe("heart");
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
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!.x).toBe(40);
    expect(editorStore.getState().historyFuture).toHaveLength(1);

    editorStore.getState().redo();
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]!.x).toBe(240);
  });

  it("starts a new undo step after an explicit history boundary", () => {
    patchText("headline", { x: 120 });
    editorStore.getState().endHistoryGroup();
    patchText("headline", { y: 220 });
    expect(editorStore.getState().historyPast).toHaveLength(2);

    editorStore.getState().undo();
    expect(editorStore.getState().project!.layouts[0]!.screens[0]!.elements[0]).toMatchObject({ x: 120, y: 100 });
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

  it("makes an authoritative project replacement non-undoable in either direction", () => {
    patchText("headline", { x: 120 });
    editorStore.getState().endHistoryGroup();
    patchText("headline", { y: 220 });
    editorStore.getState().undo();
    expect(editorStore.getState().historyPast).not.toEqual([]);
    expect(editorStore.getState().historyFuture).not.toEqual([]);

    const authoritative: Project = {
      ...structuredClone(editorStore.getState().project!),
      meta: { name: "Authoritative", schemaVersion: 1 },
      fonts: [{
        family: "Inter",
        weight: 400,
        source: "uploaded",
        path: "assets/fonts/inter-400.ttf",
      }],
    };
    editorStore.getState().replaceProject(authoritative);
    editorStore.getState().undo();
    editorStore.getState().redo();

    expect(editorStore.getState().project).toEqual(authoritative);
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
