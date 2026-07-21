// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { canvasTransitionKind } from "@web/components/canvas-viewport/layout-transition";

describe("canvas transition kind", () => {
  it("returns none when the layout and view are unchanged", () => {
    expect(canvasTransitionKind(
      { layoutId: "launch", layoutMode: "connected", view: "overview" },
      { layoutId: "launch", layoutMode: "connected", view: "overview" },
    )).toBe("none");
  });

  it("returns view when only the workspace view changes", () => {
    expect(canvasTransitionKind(
      { layoutId: "launch", layoutMode: "connected", view: "focus" },
      { layoutId: "launch", layoutMode: "connected", view: "overview" },
    )).toBe("view");
  });

  it("returns layout when the layout changes in the same workspace view", () => {
    expect(canvasTransitionKind(
      { layoutId: "launch", layoutMode: "connected", view: "overview" },
      { layoutId: "feature", layoutMode: "isolated", view: "overview" },
    )).toBe("layout");
  });

  it("prioritizes the layout transition when layout and view both change", () => {
    expect(canvasTransitionKind(
      { layoutId: "launch", layoutMode: "connected", view: "focus" },
      { layoutId: "feature", layoutMode: "isolated", view: "overview" },
    )).toBe("layout");
  });

  it("uses the layout transition when the active layout mode changes", () => {
    expect(canvasTransitionKind(
      { layoutId: "launch", layoutMode: "connected", view: "overview" },
      { layoutId: "launch", layoutMode: "isolated", view: "overview" },
    )).toBe("layout");
  });
});
