// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  isPrimaryScreen,
  setOutputFamilyScreenSetMode,
  type Project,
  type Screen,
} from "@screenshot-studio/core/model";
import * as editorScreenMutations from "./editor-screen-mutations.js";
import {
  appendBlankScreen,
  appendClonedScreen,
  removeProjectScreen,
  reorderProjectScreens,
} from "./editor-screen-mutations.js";

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
  fonts: [],
  preferredExportLayoutId: "primary",
  layouts: [{
    id: "primary",
    name: "Primary",
    mode: "isolated",
    screens: [screen("root-a"), screen("variant-a", "root-a"), screen("root-b")],
  }],
};

function synchronizedProject(): Project {
  return setOutputFamilyScreenSetMode(project, "primary", "variant-a", "synchronized");
}

describe("editor screen mutations", () => {
  it("does not expose a partial project-font replacement helper", () => {
    expect(editorScreenMutations).not.toHaveProperty("replaceProjectFonts");
  });

  it("adds a blank variant to the next compatible root without adding a master", () => {
    const result = appendBlankScreen(project, "primary", "variant-a");
    const screens = result.project.layouts[0]!.screens;
    const added = screens.find((candidate) => candidate.id === result.activeScreenId)!;

    expect(screens.filter((candidate) => candidate.storeTargetId === undefined)).toHaveLength(2);
    expect(screens.filter((candidate) => candidate.storeTargetId === "target-a")).toHaveLength(2);
    expect(added).toMatchObject({
      name: "Untitled",
      variantOf: "root-b",
      storeTargetId: "target-a",
      background: { type: "solid", color: "#FFFFFF" },
      elements: [],
    });
  });

  it("adds a cloned variant to the next compatible root without adding a master", () => {
    const result = appendClonedScreen(project, "primary", "variant-a");
    const screens = result.project.layouts[0]!.screens;
    const added = screens.find((candidate) => candidate.id === result.activeScreenId)!;

    expect(screens.filter((candidate) => candidate.storeTargetId === undefined)).toHaveLength(2);
    expect(added).toMatchObject({
      name: "variant-a copy",
      variantOf: "root-b",
      storeTargetId: "target-a",
    });
    expect(added.elements).toHaveLength(1);
    expect(added.elements[0]!.id).not.toBe(project.layouts[0]!.screens[1]!.elements[0]!.id);
  });

  it("keeps an extra independent blank target screen standalone after every primary slot is occupied", () => {
    const first = appendBlankScreen(project, "primary", "variant-a");
    const second = appendBlankScreen(first.project, "primary", first.activeScreenId!);
    const screens = second.project.layouts[0]!.screens;
    const addedVariant = screens.find((candidate) => candidate.id === second.activeScreenId)!;

    expect(screens.filter((candidate) => candidate.storeTargetId === undefined)).toHaveLength(2);
    expect(screens.filter((candidate) => candidate.storeTargetId === "target-a")).toHaveLength(3);
    expect(addedVariant).toMatchObject({
      name: "Untitled",
      storeTargetId: "target-a",
      background: { type: "solid", color: "#FFFFFF" },
      elements: [],
    });
    expect(addedVariant.variantOf).toBeUndefined();
  });

  it("keeps an extra independent cloned target screen standalone after every primary slot is occupied", () => {
    const first = appendClonedScreen(project, "primary", "variant-a");
    const second = appendClonedScreen(first.project, "primary", first.activeScreenId!);
    const screens = second.project.layouts[0]!.screens;
    const addedVariant = screens.find((candidate) => candidate.id === second.activeScreenId)!;

    expect(screens.filter((candidate) => candidate.storeTargetId === undefined)).toHaveLength(2);
    expect(screens.filter((candidate) => candidate.storeTargetId === "target-a")).toHaveLength(3);
    expect(addedVariant.variantOf).toBeUndefined();
    expect(addedVariant.elements).toHaveLength(1);
  });

  it("keeps adding to an independent exact-size row after its last primary screen was removed", () => {
    const standalone = {
      ...screen("standalone-target"),
      storeTargetId: "target-a",
    } satisfies Screen;
    const otherFamily = {
      ...screen("web-root"),
      platform: "web",
      device: "desktop",
    } satisfies Screen;
    const source = structuredClone(project);
    source.layouts[0]!.screens = [standalone, otherFamily];

    const result = appendBlankScreen(source, "primary", standalone.id);
    const screens = result.project.layouts[0]!.screens;
    const added = screens.find((candidate) => candidate.id === result.activeScreenId)!;

    expect(screens.filter((candidate) => candidate.platform === "apple" && isPrimaryScreen(candidate)))
      .toHaveLength(0);
    expect(screens.filter((candidate) => candidate.storeTargetId === "target-a"))
      .toHaveLength(2);
    expect(added).toMatchObject({
      platform: "apple",
      device: "iphone",
      storeTargetId: "target-a",
      elements: [],
    });
    expect(added.variantOf).toBeUndefined();
  });

  it.each([
    ["locale", { ...screen("root-uk"), locale: "uk" } as Screen],
    ["device family", { ...screen("root-ipad"), device: "ipad" } as Screen],
    ["platform family", {
      ...screen("root-web"),
      platform: "web",
      device: "desktop",
    } as Screen],
  ])("never attaches a new variant to a root from another %s", (_scope, foreignRoot) => {
    const scopedProject = structuredClone(project);
    scopedProject.layouts[0]!.screens.splice(2, 0, foreignRoot);
    const result = appendBlankScreen(scopedProject, "primary", "variant-a");
    const added = result.project.layouts[0]!.screens.find(
      (candidate) => candidate.id === result.activeScreenId,
    )!;

    expect(added.variantOf).toBe("root-b");
    expect(added.locale).toBe("en");
  });

  it("removing an independent primary detaches its exact-size screen", () => {
    const result = removeProjectScreen(project, "primary", "root-a", "root-a", [
      { screenId: "variant-a", elementId: "text-a" },
    ]);
    expect(result.project.layouts[0]!.screens.map((candidate: Screen) => candidate.id))
      .toEqual(["variant-a", "root-b"]);
    expect(result.project.layouts[0]!.screens[0]).toMatchObject({
      id: "variant-a",
      storeTargetId: "target-a",
    });
    expect(result.project.layouts[0]!.screens[0]!.variantOf).toBeUndefined();
    expect(result.activeScreenId).toBe("root-b");
    expect(result.selectedItems).toEqual([]);
  });

  it("adds one logical blank screen to master and every exact size when synchronized", () => {
    const source = synchronizedProject();
    const targetVariant = source.layouts[0]!.screens.find((candidate) =>
      candidate.variantOf === "root-a" && candidate.storeTargetId === "target-a"
    )!;
    const result = appendBlankScreen(source, "primary", targetVariant.id);
    const screens = result.project.layouts[0]!.screens;
    const roots = screens.filter((candidate) => candidate.storeTargetId === undefined);
    const variants = screens.filter((candidate) => candidate.storeTargetId === "target-a");
    const active = screens.find((candidate) => candidate.id === result.activeScreenId)!;

    expect(roots).toHaveLength(3);
    expect(variants).toHaveLength(3);
    expect(variants.map((candidate) => candidate.variantOf)).toEqual(
      roots.map((candidate) => candidate.id),
    );
    expect(active).toMatchObject({ variantOf: roots.at(-1)!.id, elements: [] });
  });

  it("keeps synchronized master and variant order aligned when either row is reordered", () => {
    const source = synchronizedProject();
    const variants = source.layouts[0]!.screens.filter((candidate) =>
      candidate.storeTargetId === "target-a"
    );
    const result = reorderProjectScreens(source, "primary", variants[1]!.id, variants[0]!.id);
    const screens = result.layouts[0]!.screens;

    expect(screens.filter((candidate) => candidate.storeTargetId === undefined).map((candidate) => candidate.id))
      .toEqual(["root-b", "root-a"]);
    expect(screens.filter((candidate) => candidate.storeTargetId === "target-a").map((candidate) => candidate.variantOf))
      .toEqual(["root-b", "root-a"]);
  });

  it("deleting a synchronized variant deletes its logical master slot and sibling variants", () => {
    const source = synchronizedProject();
    const targetVariant = source.layouts[0]!.screens.find((candidate) =>
      candidate.variantOf === "root-a" && candidate.storeTargetId === "target-a"
    )!;
    const result = removeProjectScreen(source, "primary", targetVariant.id, targetVariant.id, []);
    const screens = result.project.layouts[0]!.screens;

    expect(screens.some((candidate) =>
      candidate.id === "root-a" || candidate.variantOf === "root-a"
    )).toBe(false);
    expect(screens.find((candidate) => candidate.id === result.activeScreenId)).toMatchObject({
      variantOf: "root-b",
      storeTargetId: "target-a",
    });
    expect(screens.filter((candidate) => candidate.storeTargetId === undefined)).toHaveLength(1);
    expect(screens.filter((candidate) => candidate.storeTargetId === "target-a")).toHaveLength(1);
  });

  it("deletes a standalone independent target screen without changing primary slots", () => {
    const first = appendBlankScreen(project, "primary", "variant-a");
    const second = appendBlankScreen(first.project, "primary", first.activeScreenId!);
    const standalone = second.project.layouts[0]!.screens.find(
      (candidate) => candidate.id === second.activeScreenId,
    )!;

    const result = removeProjectScreen(
      second.project,
      "primary",
      standalone.id,
      standalone.id,
      [],
    );
    const screens = result.project.layouts[0]!.screens;

    expect(screens.filter((candidate) => candidate.storeTargetId === undefined))
      .toHaveLength(2);
    expect(screens.filter((candidate) => candidate.storeTargetId === "target-a"))
      .toHaveLength(2);
    expect(screens.some((candidate) => candidate.id === standalone.id)).toBe(false);
  });
});
