import { describe, it, expect } from "vitest";
import { parseProject, ProjectValidationError, getScreen, SCHEMA_VERSION } from "./index.js";

function validProject() {
  return {
    meta: { name: "Sample", schemaVersion: SCHEMA_VERSION },
    platforms: ["apple"],
    locales: ["en"],
    fonts: [],
    screens: [
      {
        id: "s1",
        name: "Screen 1",
        platform: "apple",
        device: "iphone",
        locale: "en",
        artboard: { width: 1320, height: 2868 },
        background: { type: "solid", color: "#0A0A0A" },
        elements: [
          {
            id: "t1",
            type: "text",
            x: 100,
            y: 100,
            width: 1120,
            height: 300,
            content: "Hello",
            fontFamily: "Inter",
            size: 96,
            color: "#FFFFFF",
          },
        ],
      },
    ],
  };
}

describe("parseProject", () => {
  it("accepts a valid project and applies element defaults", () => {
    const project = parseProject(validProject());
    const el = project.screens[0]!.elements[0]!;
    expect(el.opacity).toBe(1);
    expect(el.visible).toBe(true);
    expect(el.rotation).toBe(0);
  });

  it("rejects unknown keys (strict contract)", () => {
    const bad = validProject();
    (bad as Record<string, unknown>).unexpected = true;
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("rejects a wrong schemaVersion", () => {
    const bad = validProject();
    bad.meta.schemaVersion = 99 as unknown as typeof SCHEMA_VERSION;
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("rejects a non-hex color", () => {
    const bad = validProject();
    bad.screens[0]!.background.color = "black";
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("rejects an unknown element type via the discriminated union", () => {
    const bad = validProject();
    (bad.screens[0]!.elements[0] as Record<string, unknown>).type = "screenshot";
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("requires at least one screen", () => {
    const bad = validProject();
    bad.screens = [];
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });
});

describe("getScreen", () => {
  it("returns a screen by id", () => {
    const project = parseProject(validProject());
    expect(getScreen(project, "s1").name).toBe("Screen 1");
  });

  it("throws for an unknown screen id", () => {
    const project = parseProject(validProject());
    expect(() => getScreen(project, "nope")).toThrow(/not found/);
  });
});
