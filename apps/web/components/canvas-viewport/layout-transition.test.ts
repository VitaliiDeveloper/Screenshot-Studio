// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { canvasTransitionKind, type CanvasTransitionState } from "./layout-transition";

const state = (overrides: Partial<CanvasTransitionState>): CanvasTransitionState => ({
  layoutId: "launch",
  layoutMode: "connected",
  view: "overview",
  activeScreenId: "one",
  screenIds: ["one", "two", "three"],
  ...overrides,
});

describe("canvas transition kind", () => {
  it("returns none when the layout and view are unchanged", () => {
    expect(canvasTransitionKind(state({}), state({}))).toBe("none");
  });

  it("returns view when only the workspace view changes", () => {
    expect(canvasTransitionKind(state({ view: "focus" }), state({ view: "overview" }))).toBe("view");
  });

  it("returns layout when the layout changes in the same workspace view", () => {
    expect(canvasTransitionKind(
      state({}),
      state({ layoutId: "feature", layoutMode: "isolated" }),
    )).toBe("layout");
  });

  it("prioritizes the layout transition when layout and view both change", () => {
    expect(canvasTransitionKind(
      state({ view: "focus" }),
      state({ layoutId: "feature", layoutMode: "isolated", view: "overview" }),
    )).toBe("layout");
  });

  it("uses the layout transition when the active layout mode changes", () => {
    expect(canvasTransitionKind(state({}), state({ layoutMode: "isolated" }))).toBe("layout");
  });

  it("returns screen when Focus switches between existing screens in either direction", () => {
    expect(canvasTransitionKind(
      state({ view: "focus" }),
      state({ view: "focus", activeScreenId: "three" }),
    )).toBe("screen");
    expect(canvasTransitionKind(
      state({ view: "focus", activeScreenId: "three" }),
      state({ view: "focus", activeScreenId: "one" }),
    )).toBe("screen");
  });

  it("does not animate active-screen changes in Overview", () => {
    expect(canvasTransitionKind(state({}), state({ activeScreenId: "two" }))).toBe("none");
  });

  it("does not animate screen creation, deletion, or reorder", () => {
    expect(canvasTransitionKind(
      state({ view: "focus" }),
      state({ view: "focus", activeScreenId: "four", screenIds: ["one", "two", "three", "four"] }),
    )).toBe("none");
    expect(canvasTransitionKind(
      state({ view: "focus" }),
      state({ view: "focus", activeScreenId: "two", screenIds: ["two", "three"] }),
    )).toBe("none");
    expect(canvasTransitionKind(
      state({ view: "focus" }),
      state({ view: "focus", screenIds: ["two", "one", "three"] }),
    )).toBe("none");
  });

  it("keeps the layout and view transitions when the active screen also changes", () => {
    expect(canvasTransitionKind(
      state({ view: "focus" }),
      state({ view: "focus", layoutId: "feature", activeScreenId: "two" }),
    )).toBe("layout");
    expect(canvasTransitionKind(
      state({}),
      state({ view: "focus", activeScreenId: "two" }),
    )).toBe("view");
  });
});
