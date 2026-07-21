// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import type { StoreSize } from "@screenshot-studio/core/export";
import {
  createStoreTargetVariant,
  deleteStoreTargetVariant,
} from "./editor-project-actions.js";

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
  fonts: [],
  preferredExportLayoutId: "primary",
  layouts: [{
    id: "primary",
    name: "Primary",
    mode: "isolated",
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
  }],
};

describe("editor project actions", () => {
  it("creating a target variant preserves the active screen and clears selection", () => {
    const result = createStoreTargetVariant(project, "primary", rootId, target);
    expect(result.project.layouts[0]!.screens.some((screen) =>
      screen.storeTargetId === target.id,
    )).toBe(true);
    expect(result.activeScreenId).toBe(rootId);
    expect(result.selectedItems).toEqual([]);
  });

  it("removes a standalone exact-size screen and returns to the family primary", () => {
    const created = createStoreTargetVariant(project, "primary", rootId, target).project;
    const standalone = created.layouts[0]!.screens.find((screen) =>
      screen.storeTargetId === target.id
    )!;
    delete standalone.variantOf;

    const result = deleteStoreTargetVariant(
      created,
      "primary",
      standalone.id,
      [{ screenId: standalone.id, elementId: "selected" }],
      standalone.id,
      target.id,
    );

    expect(result.project.layouts[0]!.screens.map((screen) => screen.id)).toEqual([rootId]);
    expect(result.activeScreenId).toBe(rootId);
    expect(result.selectedItems).toEqual([]);
  });

  it("removes every independent screen in the selected exact-size row", () => {
    const created = createStoreTargetVariant(project, "primary", rootId, target).project;
    const exact = created.layouts[0]!.screens.find((screen) => screen.storeTargetId === target.id)!;
    const standalone = structuredClone(exact);
    standalone.id = "standalone-target";
    delete standalone.variantOf;
    created.layouts[0]!.screens.push(standalone);

    const result = deleteStoreTargetVariant(
      created,
      "primary",
      standalone.id,
      [{ screenId: standalone.id, elementId: "selected" }],
      standalone.id,
      target.id,
    );

    expect(result.project.layouts[0]!.screens.map((screen) => screen.id)).toEqual([rootId]);
    expect(result.activeScreenId).toBe(rootId);
    expect(result.selectedItems).toEqual([]);
  });
});
