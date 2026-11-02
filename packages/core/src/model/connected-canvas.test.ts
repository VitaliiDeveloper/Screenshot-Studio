// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { DesignLayout, Project } from "./schema.js";
import {
  findOwnerOverflows,
  projectScreenGroup,
  renderedElementBounds,
  rotatedElementBounds,
  sameScreenGroup,
} from "./connected-canvas.js";
import { cloneLocaleSet, copyScreenToLocale, setLocaleDirection } from "./project-locale-ops.js";

function project(): Project {
  return {
    meta: { name: "Connected", schemaVersion: 1 },
    fonts: [],
    preferredExportLayoutId: "connected",
    layouts: [{
      id: "connected", name: "Connected", mode: "connected",
      screens: [
        screen("first", "apple", "en", 100),
        screen("french", "apple", "fr", 80),
        screen("second", "apple", "en", 120),
        screen("android", "android", "en", 90),
        screen("third", "apple", "en", 140),
      ],
    }],
  };
}

function screen(
  id: string,
  platform: "apple" | "android",
  locale: string,
  width: number,
): DesignLayout["screens"][number] {
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
    const [first, french, , android] = project().layouts[0]!.screens;
    expect(sameScreenGroup(first!, french!)).toBe(false);
    expect(sameScreenGroup(first!, android!)).toBe(false);
    expect(sameScreenGroup(first!, project().layouts[0]!.screens[2]!)).toBe(true);
    expect(sameScreenGroup(first!, { ...project().layouts[0]!.screens[2]!, variantOf: "first", storeTargetId: "6.5" })).toBe(false);
  });

  it("projects an interleaved group in project order with cumulative variable widths", () => {
    const projected = projectScreenGroup(project(), "connected", "second");
    expect(projected.map(({ screen, x, y }) => ({ id: screen.id, x, y }))).toEqual([
      { id: "first", x: 0, y: 0 },
      { id: "second", x: 100, y: 0 },
      { id: "third", x: 220, y: 0 },
    ]);
  });

  it("rejects an unknown target screen", () => {
    expect(() => projectScreenGroup(project(), "connected", "missing")).toThrow(/not found/);
  });
});

describe("owner overflow detection", () => {
  it("finds a visible element that crosses its owner artboard", () => {
    const connected = project();
    connected.layouts[0]!.screens[0]!.elements = [shape("bridge", 90, 20, 20, 0)];
    expect(findOwnerOverflows(connected, "connected")).toMatchObject([{ screenId: "first", elementId: "bridge" }]);
  });

  it("uses rotation-aware bounds and ignores non-rendering overflow", () => {
    const connected = project();
    const rotated = shape("rotated", 90, 20, 20, 45);
    expect(rotatedElementBounds(rotated).maxX).toBeGreaterThan(100);
    connected.layouts[0]!.screens[0]!.elements = [rotated];
    expect(findOwnerOverflows(connected, "connected").map((item) => item.elementId)).toEqual(["rotated"]);

    rotated.visible = false;
    expect(findOwnerOverflows(connected, "connected")).toEqual([]);
    rotated.visible = true;
    rotated.opacity = 0;
    expect(findOwnerOverflows(connected, "connected")).toEqual([]);
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
    connected.layouts[0]!.screens[0]!.elements = [group];
    expect(findOwnerOverflows(connected, "connected").map((item) => item.elementId)).toEqual(["group"]);

    group.children[0]!.visible = false;
    expect(findOwnerOverflows(connected, "connected")).toEqual([]);
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
    connected.layouts[0]!.screens[0]!.elements = [stroked, shadowed];
    expect(findOwnerOverflows(connected, "connected").map((overflow) => overflow.elementId))
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
    connected.layouts[0]!.screens[0]!.elements = [transparentStroke, transparentShadow, group];
    expect(findOwnerOverflows(connected, "connected")).toEqual([]);
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
    connected.layouts[0]!.screens[0]!.elements = [rotatedStroke, group];
    expect(findOwnerOverflows(connected, "connected").map((overflow) => overflow.elementId))
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

describe("connected strip direction", () => {
  const shape = (x: number): DesignLayout["screens"][number]["elements"][number] => ({
    id: "art", type: "shape", x, y: 40, width: 300, height: 60,
    rotation: 0, opacity: 1, locked: false, visible: true,
    kind: "rect", fill: "#ff0000", radius: 0,
  });

  function strip(widths: readonly number[], art: Record<number, number>): Project {
    return {
      meta: { name: "Strip", schemaVersion: 1 },
      fonts: [],
      preferredExportLayoutId: "connected",
      layouts: [{
        id: "connected", name: "Connected", mode: "connected",
        screens: widths.map((width, index) => ({
          ...screen(`s${index}`, "apple", "en", width),
          elements: index in art ? [shape(art[index]!)] : [],
        })),
      }],
    };
  }

  /** Every visible span of the art in strip coordinates, as a viewer of the strip sees it. */
  function artSpans(source: Project, locale: string): [number, number][] {
    const first = source.layouts[0]!.screens.find((candidate) => candidate.locale === locale)!;
    return projectScreenGroup(source, "connected", first.id).flatMap(({ screen: owner, x }) =>
      owner.elements.map((element): [number, number] => [x + element.x, x + element.x + element.width]));
  }

  it("lays an RTL group right to left and keeps project order for export and z-order", () => {
    const rtl = setLocaleDirection(strip([400, 500, 600], {}), "connected", "en", "rtl");
    expect(projectScreenGroup(rtl, "connected", "s1").map(({ screen: owner, x }) => [owner.id, x]))
      .toEqual([["s0", 1100], ["s1", 600], ["s2", 0]]);
  });

  it("mirrors seam-crossing art across the whole strip when a locale is cloned as RTL", () => {
    const source = strip([400, 400, 400], { 0: 300 });
    expect(artSpans(source, "en")).toEqual([[300, 600]]);

    const cloned = cloneLocaleSet(source, "connected", "en", "ar", "rtl");

    expect(cloned.layouts[0]!.screens.filter(({ locale }) => locale === "ar").map(({ name }) => name))
      .toEqual(["s0", "s1", "s2"]);
    expect(artSpans(cloned, "ar")).toEqual([[600, 900]]);
  });

  it("keeps seam-crossing art inside the strip on unequal widths and restores it on the way back", () => {
    const source = strip([400, 500, 600], { 1: 450 });
    const total = 1500;
    const [[start, end]] = artSpans(source, "en") as [[number, number]];

    const rtl = setLocaleDirection(source, "connected", "en", "rtl");
    expect(artSpans(rtl, "en")).toEqual([[total - end, total - start]]);

    const back = setLocaleDirection(rtl, "connected", "en", "ltr");
    expect(back.layouts[0]!.screens[1]!.elements[0]!.x).toBe(450);
    expect(artSpans(back, "en")).toEqual([[start, end]]);
  });

  it("keeps the art continuous when one screen is copied into an RTL locale", () => {
    const base = cloneLocaleSet(strip([400, 400], { 0: 300 }), "connected", "en", "ar", "rtl");
    const sourceId = base.layouts[0]!.screens[0]!.id;
    const withoutArt: Project = {
      ...base,
      layouts: [{
        ...base.layouts[0]!,
        screens: base.layouts[0]!.screens.filter(({ locale, name }) => locale === "en" || name === "s1"),
      }],
    };
    const { project: copied } = copyScreenToLocale(withoutArt, "connected", sourceId, "ar");
    const ar = copied.layouts[0]!.screens.filter(({ locale }) => locale === "ar").map(({ name }) => name);
    expect(ar).toEqual(["s0", "s1"]);
    expect(artSpans(copied, "ar")).toEqual([[200, 500]]);
  });
});
