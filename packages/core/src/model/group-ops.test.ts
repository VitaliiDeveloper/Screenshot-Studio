// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Screen } from "./schema.js";
import { duplicateElement, findElementLocation, groupElements, resizeGroupUniform, ungroupElement } from "./group-ops.js";

function screen(): Screen {
  return {
    id: "owner", name: "Owner", platform: "apple", device: "iphone", locale: "en", direction: "ltr",
    artboard: { width: 400, height: 300 }, background: { type: "solid", color: "#000000" },
    elements: [
      { id: "red", name: "Red", type: "shape", x: 20, y: 30, width: 40, height: 20, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#FF0000", radius: 4 },
      { id: "between", type: "shape", x: 200, y: 20, width: 20, height: 20, rotation: 0, opacity: 1, locked: false, visible: true, kind: "rect", fill: "#FFFFFF", radius: 0 },
      { id: "copy", type: "text", x: 80, y: 50, width: 100, height: 40, rotation: 0, opacity: 0.8, locked: false, visible: true, content: "Copy", fontFamily: "Inter", size: 20, weight: 400, lineHeight: 1.2, letterSpacing: 2, align: "left", color: "#FFFFFF" },
    ],
  };
}

describe("group authoring operations", () => {
  it("groups same-owner leaves at the front-most selected z slot with local coordinates", () => {
    const result = groupElements(screen(), ["red", "copy"], () => "group");
    expect(result.screen.elements.map((element) => element.id)).toEqual(["between", "group"]);
    expect(result.group).toMatchObject({ x: 20, y: 30, width: 160, height: 60, rotation: 0 });
    expect(result.group.children.map((child) => ({ id: child.id, x: child.x, y: child.y }))).toEqual([
      { id: "red", x: 0, y: 0 },
      { id: "copy", x: 60, y: 20 },
    ]);
  });

  it("rejects one item, missing items, and nested grouping", () => {
    expect(() => groupElements(screen(), ["red"])).toThrow(/at least two/);
    expect(() => groupElements(screen(), ["red", "missing"])).toThrow(/top-level/);
    const grouped = groupElements(screen(), ["red", "copy"], () => "group").screen;
    expect(() => groupElements(grouped, ["group", "between"])).toThrow(/Nested groups/);
  });

  it("ungroups rotation, opacity, lock, and visibility into equivalent leaf literals", () => {
    const grouped = groupElements(screen(), ["red", "copy"], () => "group").screen;
    const group = grouped.elements[1]!;
    if (group.type !== "group") throw new Error("expected group");
    group.x = 100;
    group.y = 50;
    group.rotation = 90;
    group.opacity = 0.5;
    group.locked = true;
    const result = ungroupElement(grouped, "group");
    expect(result.screen.elements.map((element) => element.id)).toEqual(["between", "red", "copy"]);
    expect(result.children[0]).toMatchObject({ x: 100, y: 50, rotation: 90, opacity: 0.5, locked: true });
    expect(result.children[1]).toMatchObject({ x: 80, y: 110, rotation: 90, opacity: 0.4, locked: true });
  });

  it("bakes uniform group scale into geometry and visual leaf dimensions", () => {
    const source = screen();
    const red = source.elements[0];
    const copy = source.elements[2];
    if (red?.type !== "shape" || copy?.type !== "text") throw new Error("expected leaves");
    red.stroke = { color: "#FFFFFF", width: 6 };
    copy.shadow = { color: "#000000", blur: 4, offsetX: -3, offsetY: 5, opacity: 0.8 };
    const grouped = groupElements(source, ["red", "copy"], () => "group").group;
    const resized = resizeGroupUniform(grouped, 320, 120);
    expect(resized).toMatchObject({ width: 320, height: 120 });
    expect(resized.children[0]).toMatchObject({
      width: 80, height: 40, radius: 8, stroke: { width: 12 },
    });
    expect(resized.children[1]).toMatchObject({
      x: 120, y: 40, width: 200, height: 80, size: 40, letterSpacing: 4,
      shadow: { blur: 8, offsetX: -6, offsetY: 10 },
    });
    expect(() => resizeGroupUniform(grouped, 320, 180)).toThrow(/uniformly/);
  });

  it("rejects a scale that would exceed strict schema effect bounds", () => {
    const source = screen();
    const red = source.elements[0];
    if (red?.type !== "shape") throw new Error("expected shape");
    red.stroke = { color: "#FFFFFF", width: 60 };
    const grouped = groupElements(source, ["red", "copy"], () => "group").group;

    expect(() => resizeGroupUniform(grouped, grouped.width * 2, grouped.height * 2))
      .toThrow(/cannot scale element "red".*stroke\.width.*100/i);
  });

  it("scales decorative-image corner radius with grouped geometry", () => {
    const grouped = {
      ...groupElements(screen(), ["red", "copy"], () => "group").group,
      children: [{
        id: "decor", type: "image" as const, x: 10, y: 20, width: 80, height: 60,
        rotation: 0, opacity: 1, locked: false, visible: true,
        assetUrl: "assets/decor.png", fit: "contain" as const, cornerRadius: 6,
      }],
    };
    const resized = resizeGroupUniform(grouped, grouped.width * 2, grouped.height * 2);
    expect(resized.children[0]).toMatchObject({
      type: "image", x: 20, y: 40, width: 160, height: 120, cornerRadius: 12,
    });
  });

  it("scales icon strokes with grouped geometry", () => {
    const grouped = {
      ...groupElements(screen(), ["red", "copy"], () => "group").group,
      children: [{
        id: "icon", type: "icon" as const, x: 10, y: 20, width: 80, height: 80,
        rotation: 0, opacity: 1, locked: false, visible: true,
        icon: "star" as const, color: "#FFCC00", strokeWidth: 3,
      }],
    };
    const resized = resizeGroupUniform(grouped, grouped.width * 2, grouped.height * 2);
    expect(resized.children[0]).toMatchObject({
      type: "icon", x: 20, y: 40, width: 160, height: 160, strokeWidth: 6,
    });
  });

  it("finds nested children and duplicates groups with fresh ids", () => {
    const group = groupElements(screen(), ["red", "copy"], () => "group").group;
    const owner = { ...screen(), elements: [group] };
    expect(findElementLocation(owner, "copy")?.parent?.id).toBe("group");
    const ids = ["group-copy", "red-copy", "copy-copy"];
    const duplicate = duplicateElement(group, () => ids.shift()!);
    expect(duplicate).toMatchObject({ id: "group-copy", x: 40, y: 50, name: "Group copy" });
    expect(duplicate.type === "group" && duplicate.children.map((child) => child.id))
      .toEqual(["red-copy", "copy-copy"]);
  });
});
