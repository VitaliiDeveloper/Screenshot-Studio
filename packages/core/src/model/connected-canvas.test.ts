// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "./schema.js";
import {
  findOwnerOverflows,
  projectScreenGroup,
  renderedElementBounds,
  rotatedElementBounds,
  sameScreenGroup,
  setCanvasMode,
} from "./connected-canvas.js";

function project(): Project {
  return {
    meta: { name: "Connected", schemaVersion: 1 },
    mode: "connected",
    platforms: ["apple", "android"],
    locales: ["en", "fr"],
    fonts: [],
    screens: [
      screen("first", "apple", "en", 100),
      screen("french", "apple", "fr", 80),
      screen("second", "apple", "en", 120),
      screen("android", "android", "en", 90),
      screen("third", "apple", "en", 140),
    ],
  };
}

function screen(
  id: string,
  platform: "apple" | "android",
  locale: string,
  width: number,
): Project["screens"][number] {
  const common = {
    id,
    name: id,
    locale,
    direction: "ltr" as const,
    artboard: { width, height: 200 },
    background: { type: "solid" as const, color: "#000000" },
    elements: [],
  };
  return platform === "apple"
    ? { ...common, platform: "apple", device: "iphone" }
    : { ...common, platform: "android", device: "phone" };
}

describe("connected canvas projection", () => {
  it("matches exact platform, device, and locale", () => {
    const [first, french, , android] = project().screens;
    expect(sameScreenGroup(first!, french!)).toBe(false);
    expect(sameScreenGroup(first!, android!)).toBe(false);
    expect(sameScreenGroup(first!, project().screens[2]!)).toBe(true);
    expect(sameScreenGroup(first!, { ...project().screens[2]!, variantOf: "first", storeTargetId: "6.5" })).toBe(false);
  });

  it("projects an interleaved group in project order with cumulative variable widths", () => {
    const projected = projectScreenGroup(project(), "second");
    expect(projected.map(({ screen, x, y }) => ({ id: screen.id, x, y }))).toEqual([
      { id: "first", x: 0, y: 0 },
      { id: "second", x: 100, y: 0 },
      { id: "third", x: 220, y: 0 },
    ]);
  });

  it("rejects an unknown target screen", () => {
    expect(() => projectScreenGroup(project(), "missing")).toThrow(/not found/);
  });
});

describe("canvas mode transitions", () => {
  it("switches isolated to connected and is idempotent", () => {
    const isolated = { ...project(), mode: "isolated" as const };
    const connected = setCanvasMode(isolated, "connected");
    expect(connected.mode).toBe("connected");
    expect(setCanvasMode(connected, "connected")).toBe(connected);
  });

  it("refuses connected to isolated when a visible element crosses its owner artboard", () => {
    const connected = project();
    connected.screens[0]!.elements = [shape("bridge", 90, 20, 20, 0)];
    expect(findOwnerOverflows(connected)).toMatchObject([{ screenId: "first", elementId: "bridge" }]);
    expect(() => setCanvasMode(connected, "isolated")).toThrow(/bridge.*first.*crosses/);
  });

  it("uses rotation-aware bounds and ignores non-rendering overflow", () => {
    const connected = project();
    const rotated = shape("rotated", 90, 20, 20, 45);
    expect(rotatedElementBounds(rotated).maxX).toBeGreaterThan(100);
    connected.screens[0]!.elements = [rotated];
    expect(() => setCanvasMode(connected, "isolated")).toThrow(/rotated/);

    rotated.visible = false;
    expect(setCanvasMode(connected, "isolated").mode).toBe("isolated");
    rotated.visible = true;
    rotated.opacity = 0;
    expect(setCanvasMode(connected, "isolated").mode).toBe("isolated");
  });

  it("uses transformed child pixels rather than only declared group bounds", () => {
    const connected = project();
    const group = {
      id: "group", type: "group" as const, x: 0, y: 0, width: 50, height: 50,
      rotation: 0, opacity: 1, locked: false, visible: true,
      children: [shape("child", 80, 30, 20, 0)],
    };
    expect(rotatedElementBounds(group).maxX).toBe(50);
    expect(renderedElementBounds(group)?.maxX).toBe(110);
    connected.screens[0]!.elements = [group];
    expect(() => setCanvasMode(connected, "isolated")).toThrow(/group/);

    group.children[0]!.visible = false;
    expect(setCanvasMode(connected, "isolated").mode).toBe("isolated");
  });

  it("includes directional text shadows and shape strokes in visible overflow", () => {
    const connected = project();
    const stroked = {
      ...shape("stroked", 89, 10, 20, 0),
      stroke: { color: "#FFFFFF", width: 4 },
    };
    const shadowed = {
      id: "shadowed", type: "text" as const, x: 80, y: 20, width: 10, height: 20,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "A", fontFamily: "Inter", size: 12, weight: 400,
      lineHeight: 1.2, letterSpacing: 0, align: "left" as const, color: "#FFFFFF",
      shadow: { color: "#000000", blur: 0, offsetX: 12, offsetY: 0, opacity: 1 },
    };

    expect(rotatedElementBounds(stroked).maxX).toBe(99);
    expect(renderedElementBounds(stroked)?.maxX).toBe(101);
    expect(rotatedElementBounds(shadowed).maxX).toBe(90);
    expect(renderedElementBounds(shadowed)?.maxX).toBe(102);
    connected.screens[0]!.elements = [stroked, shadowed];
    expect(findOwnerOverflows(connected).map((overflow) => overflow.elementId))
      .toEqual(["stroked", "shadowed"]);
  });

  it("ignores fully transparent effect pixels for top-level leaves and grouped children", () => {
    const connected = project();
    const transparentStroke = {
      ...shape("transparent-stroke", 89, 10, 20, 0),
      stroke: { color: "#FFFFFF00", width: 4 },
    };
    const transparentShadow = {
      id: "transparent-shadow", type: "text" as const, x: 80, y: 20, width: 10, height: 20,
      rotation: 0, opacity: 1, locked: false, visible: true,
      content: "A", fontFamily: "Inter", size: 12, weight: 400,
      lineHeight: 1.2, letterSpacing: 0, align: "left" as const, color: "#FFFFFF",
      shadow: { color: "#00000000", blur: 0, offsetX: 12, offsetY: 0, opacity: 1 },
    };
    const group = {
      id: "transparent-effects-group", type: "group" as const,
      x: 0, y: 0, width: 100, height: 50,
      rotation: 0, opacity: 1, locked: false, visible: true,
      children: [
        { ...transparentStroke, id: "grouped-stroke" },
        { ...transparentShadow, id: "grouped-shadow" },
      ],
    };

    expect(renderedElementBounds(transparentStroke)?.maxX).toBe(99);
    expect(renderedElementBounds(transparentShadow)?.maxX).toBe(90);
    expect(renderedElementBounds(group)?.maxX).toBe(99);
    connected.screens[0]!.elements = [transparentStroke, transparentShadow, group];
    expect(findOwnerOverflows(connected)).toEqual([]);
  });

  it("rotates effect-aware bounds for top-level leaves and grouped children", () => {
    const connected = project();
    const rotatedStroke = {
      ...shape("rotated-stroke", 92, 8, 8, 45),
      stroke: { color: "#FFFFFF", width: 4 },
    };
    const group = {
      id: "effect-group", type: "group" as const, x: 0, y: 0, width: 100, height: 50,
      rotation: 0, opacity: 1, locked: false, visible: true,
      children: [{ ...shape("child", 89, 10, 20, 0), stroke: { color: "#FFFFFF", width: 4 } }],
    };

    expect(rotatedElementBounds(rotatedStroke).maxX).toBeLessThan(100);
    expect(renderedElementBounds(rotatedStroke)?.maxX).toBeGreaterThan(100);
    expect(renderedElementBounds(group)?.maxX).toBe(101);
    connected.screens[0]!.elements = [rotatedStroke, group];
    expect(findOwnerOverflows(connected).map((overflow) => overflow.elementId))
      .toEqual(["rotated-stroke", "effect-group"]);
  });
});

function shape(id: string, x: number, width: number, height: number, rotation: number) {
  return {
    id,
    type: "shape" as const,
    x,
    y: 10,
    width,
    height,
    rotation,
    opacity: 1,
    locked: false,
    visible: true,
    kind: "rect" as const,
    fill: "#FF0000",
    radius: 0,
  };
}
