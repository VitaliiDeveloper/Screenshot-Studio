// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import type { StoreSize } from "@screenshot-studio/core/export";
import { createStoreTargetVariant } from "./editor-project-actions.js";

const rootId = "root-a";
const target: StoreSize = {
  id: "target-a",
  label: "Target A",
  width: 1284,
  height: 2778,
  orientation: "portrait",
};
const project: Project = {
  meta: { name: "Targets", schemaVersion: 1 },
  mode: "isolated",
  platforms: ["apple"],
  locales: ["en"],
  fonts: [],
  screens: [{
    id: rootId,
    name: "Root A",
    platform: "apple",
    device: "iphone",
    locale: "en",
    direction: "ltr",
    artboard: { width: 660, height: 1434 },
    background: { type: "solid", color: "#000000" },
    elements: [],
  }],
};

describe("editor project actions", () => {
  it("creating a target variant preserves the active screen and clears selection", () => {
    const result = createStoreTargetVariant(project, rootId, target);
    expect(result.project.screens.some((screen: Project["screens"][number]) =>
      screen.storeTargetId === target.id,
    )).toBe(true);
    expect(result.activeScreenId).toBe(rootId);
    expect(result.selectedItems).toEqual([]);
  });
});
