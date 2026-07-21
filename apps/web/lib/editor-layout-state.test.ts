// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { editorStore } from "@web/lib/editor-store.js";

function project(): Project {
  return {
    meta: { name: "Layouts", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "launch",
    layouts: [
      {
        id: "launch",
        name: "Launch",
        mode: "isolated",
        screens: [{
          id: "hero",
          name: "Hero",
          platform: "apple",
          device: "iphone",
          locale: "en",
          direction: "ltr",
          artboard: { width: 660, height: 1434 },
          background: { type: "linear-gradient", from: "#111111", to: "#222222", angle: 90 },
          elements: [{
            id: "title",
            type: "text",
            x: 40,
            y: 100,
            width: 580,
            height: 200,
            rotation: 0,
            opacity: 1,
            locked: false,
            visible: true,
            content: "Launch",
            fontFamily: "Inter",
            size: 72,
            weight: 700,
            lineHeight: 1.2,
            letterSpacing: 0,
            align: "left",
            color: "#FFFFFF",
          }],
        }],
      },
      {
        id: "feature",
        name: "Feature",
        mode: "connected",
        screens: [{
          id: "feature-screen",
          name: "Feature",
          platform: "android",
          device: "phone",
          locale: "uk",
          direction: "ltr",
          artboard: { width: 1080, height: 1920 },
          background: { type: "solid", color: "#333333" },
          elements: [],
        }],
      },
    ],
  };
}

describe("editor layout state", () => {
  beforeEach(() => {
    editorStore.setState({
      project: null,
      activeLayoutId: null,
      activeScreenId: null,
      selectedItems: [],
      historyPast: [],
      historyFuture: [],
      layoutHistories: {},
      historyGroupKey: null,
    });
  });

  it("loads a valid local layout preference and otherwise falls back to preferred export", () => {
    editorStore.getState().load(project(), "feature");
    expect(editorStore.getState()).toMatchObject({
      activeLayoutId: "feature",
      activeScreenId: "feature-screen",
    });

    editorStore.getState().load(project(), "missing");
    expect(editorStore.getState()).toMatchObject({
      activeLayoutId: "launch",
      activeScreenId: "hero",
    });
  });

  it("switches layouts without changing the persisted project or rejecting mode differences", () => {
    editorStore.getState().load(project());
    const before = editorStore.getState().project;

    editorStore.getState().selectLayout("feature");

    expect(editorStore.getState().project).toBe(before);
    expect(editorStore.getState()).toMatchObject({
      activeLayoutId: "feature",
      activeScreenId: "feature-screen",
      selectedItems: [],
    });
  });

  it("switches the active layout mode without rejecting its existing content", () => {
    editorStore.getState().load(project());

    editorStore.getState().setLayoutMode("launch", "connected");

    expect(editorStore.getState().project!.layouts[0]).toMatchObject({
      id: "launch",
      mode: "connected",
      screens: project().layouts[0]!.screens,
    });
  });

  it("creates a clean layout from active screen dimensions and a default background", () => {
    editorStore.getState().load(project());

    editorStore.getState().addLayout("Clean", "connected");

    const state = editorStore.getState();
    const added = state.project!.layouts.find((layout) => layout.name === "Clean")!;
    expect(state.activeLayoutId).toBe(added.id);
    expect(added).toMatchObject({ mode: "connected" });
    expect(added.screens).toHaveLength(1);
    expect(added.screens[0]).toMatchObject({
      platform: "apple",
      device: "iphone",
      locale: "en",
      direction: "ltr",
      artboard: { width: 660, height: 1434 },
      background: { type: "solid", color: "#FFFFFF" },
      elements: [],
    });
    expect(state.historyPast).toEqual([]);
  });

  it("duplicates layout content with fresh layout, screen, and element ids", () => {
    editorStore.getState().load(project());

    editorStore.getState().duplicateLayout("launch", "Launch copy");

    const state = editorStore.getState();
    const copy = state.project!.layouts.find((layout) => layout.name === "Launch copy")!;
    expect(copy.mode).toBe("isolated");
    expect(copy.id).not.toBe("launch");
    expect(copy.screens[0]!.id).not.toBe("hero");
    expect(copy.screens[0]!.elements[0]!.id).not.toBe("title");
    expect(copy.screens[0]!.elements[0]).toMatchObject({ type: "text", content: "Launch" });
    expect(state.activeLayoutId).toBe(copy.id);
  });

  it("keeps content undo history independent per layout and excludes layout lifecycle", () => {
    editorStore.getState().load(project());
    editorStore.getState().patchElement({
      id: "title",
      type: "text",
      patch: { content: "Changed" },
    });
    expect(editorStore.getState().historyPast).toHaveLength(1);

    editorStore.getState().selectLayout("feature");
    expect(editorStore.getState().historyPast).toEqual([]);
    editorStore.getState().addLayout("Clean", "isolated");
    expect(editorStore.getState().historyPast).toEqual([]);

    editorStore.getState().selectLayout("launch");
    expect(editorStore.getState().historyPast).toHaveLength(1);
    editorStore.getState().undo();
    const launch = editorStore.getState().project!.layouts.find((layout) => layout.id === "launch")!;
    expect(launch.screens[0]!.elements[0]).toMatchObject({ type: "text", content: "Launch" });
  });
});
