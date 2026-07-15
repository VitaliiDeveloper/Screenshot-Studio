// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project, Screen } from "@screenshot-studio/core/model";
import * as editorScreenMutations from "./editor-screen-mutations.js";
import { removeProjectScreen } from "./editor-screen-mutations.js";

function screen(id: string, variantOf?: string): Screen {
  return {
    id,
    name: id,
    platform: "apple",
    device: "iphone",
    locale: "en",
    direction: "ltr",
    ...(variantOf ? { variantOf, storeTargetId: "target-a" } : {}),
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#000000" },
    elements: [{
      id: "text-a",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      opacity: 1,
      locked: false,
      visible: true,
      content: id,
      fontFamily: "Inter",
      size: 24,
      weight: 400,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: "left",
      color: "#ffffff",
    }],
  };
}

const project: Project = {
  meta: { name: "Screens", schemaVersion: 1 },
  mode: "isolated",
  platforms: ["apple"],
  locales: ["en"],
  fonts: [],
  screens: [screen("root-a"), screen("variant-a", "root-a"), screen("root-b")],
};

describe("editor screen mutations", () => {
  it("does not expose a partial project-font replacement helper", () => {
    expect(editorScreenMutations).not.toHaveProperty("replaceProjectFonts");
  });

  it("removing an active root removes its variants and chooses the locale fallback", () => {
    const result = removeProjectScreen(project, "root-a", "root-a", [
      { screenId: "variant-a", elementId: "text-a" },
    ]);
    expect(result.project.screens.map((candidate: Screen) => candidate.id)).toEqual(["root-b"]);
    expect(result.activeScreenId).toBe("root-b");
    expect(result.selectedItems).toEqual([]);
  });
});
