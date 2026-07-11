// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createBadgePrimitive } from "./badge-primitives.js";
import { mirrorElement } from "./element-tree.js";
import { Element, SCHEMA_VERSION } from "./schema.js";

const font = { family: "Inter", weight: 700 };

describe("badge primitive compositions", () => {
  it("keeps the current schema free of a redundant badge union member", () => {
    expect(SCHEMA_VERSION).toBe(6);
    expect(() => Element.parse({
      id: "badge", type: "badge", x: 0, y: 0, width: 100, height: 40,
    })).toThrow();
  });

  it("creates a valid fresh-id rating group from ordinary leaves", () => {
    const ids = ["group", "background", "star", "copy"];
    const badge = createBadgePrimitive({ kind: "rating", font, createId: () => ids.shift()! });
    expect(() => Element.parse(badge)).not.toThrow();
    expect(badge).toMatchObject({
      id: "group", name: "Rating badge", x: 100, y: 100, width: 420, height: 120,
    });
    expect(badge.children.map((child) => ({ id: child.id, type: child.type }))).toEqual([
      { id: "background", type: "shape" },
      { id: "star", type: "icon" },
      { id: "copy", type: "text" },
    ]);
    expect(badge.children[2]).toMatchObject({
      content: "4.9 • 12K ratings", fontFamily: "Inter", weight: 700,
    });
    expect(badge.children.every((child) => !("role" in child))).toBe(true);
  });

  it("creates a valid as-seen-on group and freshens every identity per call", () => {
    const first = createBadgePrimitive({ kind: "as-seen-on", font });
    const second = createBadgePrimitive({ kind: "as-seen-on", font });
    expect(() => Element.parse(first)).not.toThrow();
    expect(first).toMatchObject({ name: "As seen on badge", width: 460, height: 120 });
    expect(first.children[1]).toMatchObject({ type: "icon", icon: "sparkles" });
    expect(first.children[2]).toMatchObject({ type: "text", content: "AS SEEN ON" });
    expect(new Set([first.id, ...first.children.map((child) => child.id)]).size).toBe(4);
    expect([first.id, ...first.children.map((child) => child.id)])
      .not.toEqual([second.id, ...second.children.map((child) => child.id)]);
  });

  it("uses ordinary group RTL mirroring for icon placement and text alignment", () => {
    const badge = createBadgePrimitive({ kind: "rating", font, x: 100 });
    const mirrored = mirrorElement(badge, 660);
    if (mirrored.type !== "group") throw new Error("expected group");
    expect(mirrored.x).toBe(140);
    expect(mirrored.children[1]).toMatchObject({ type: "icon", x: 328 });
    expect(mirrored.children[2]).toMatchObject({ type: "text", x: 28, align: "right" });
  });
});
