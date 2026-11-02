// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  addLayout,
  addScreenToProject,
  duplicateLayout,
  getLayout,
  getScreen,
  getPreferredExportLayout,
  layoutLocales,
  layoutPlatforms,
  parseProject,
  preferLayout,
  Project,
  removeLayout,
  renameLayout,
  resolveLayoutReference,
  SCHEMA_VERSION,
  setLayoutMode,
} from "./index.js";

type MutableScreenInput = {
  id: string;
  name: string;
  platform: string;
  device: string;
  locale: string;
  artboard: { width: number; height: number };
  background: Record<string, unknown>;
  elements: unknown[];
  variantOf?: string;
  storeTargetId?: string;
};

type MutableProjectInput = {
  meta: { name: string; schemaVersion: number };
  fonts: unknown[];
  preferredExportLayoutId: string;
  layouts: Array<{
    id: string;
    name: string;
    mode: "isolated" | "connected";
    screens: MutableScreenInput[];
  }>;
};

function screen(id = "hero"): MutableScreenInput {
  return {
    id,
    name: "Hero",
    platform: "apple" as const,
    device: "iphone" as const,
    locale: "en",
    artboard: { width: 1320, height: 2868 },
    background: { type: "solid" as const, color: "#0B1020" },
    elements: [],
  };
}

function projectInput(): MutableProjectInput {
  return {
    meta: { name: "Sample", schemaVersion: SCHEMA_VERSION },
    fonts: [],
    preferredExportLayoutId: "launch",
    layouts: [
      {
        id: "launch",
        name: "Launch",
        mode: "isolated" as const,
        screens: [screen()],
      },
    ],
  };
}

function issues(input: unknown) {
  const result = Project.safeParse(input);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("expected validation failure");
  return result.error.issues.map(({ message, path }) => ({ message, path }));
}

describe("independent design layout schema", () => {
  it("accepts the strict v1 layouts root without legacy project fields", () => {
    const project = parseProject(projectInput());

    expect(project.preferredExportLayoutId).toBe("launch");
    expect(project.layouts[0]?.screens[0]?.id).toBe("hero");
    expect(project).not.toHaveProperty("mode");
    expect(project).not.toHaveProperty("platforms");
    expect(project).not.toHaveProperty("locales");
    expect(project).not.toHaveProperty("screens");
  });

  it("requires the preferred export layout id to resolve", () => {
    const input = projectInput();
    input.preferredExportLayoutId = "missing";

    expect(issues(input)).toContainEqual({
      message: 'preferred export layout "missing" does not exist',
      path: ["preferredExportLayoutId"],
    });
  });

  it("rejects duplicate layout ids and normalized names", () => {
    const input = projectInput();
    input.layouts.push({
      ...structuredClone(input.layouts[0]!),
      name: "LAUNCH",
    });

    expect(issues(input)).toEqual(expect.arrayContaining([
      { message: 'duplicate layout id: "launch"', path: ["layouts", 1, "id"] },
      { message: 'duplicate layout name: "LAUNCH"', path: ["layouts", 1, "name"] },
    ]));
  });

  it("compares layout names independently of the host locale", () => {
    const turkishLowerCase = vi.spyOn(String.prototype, "toLocaleLowerCase")
      .mockImplementation(function (this: string) { return this.replaceAll("I", "ı").toLowerCase(); });
    const input = projectInput();
    input.layouts[0]!.name = "Info";
    input.layouts.push({ ...structuredClone(input.layouts[0]!), id: "other", name: "info" });

    try {
      expect(issues(input)).toContainEqual({
        message: 'duplicate layout name: "info"',
        path: ["layouts", 1, "name"],
      });
    } finally {
      turkishLowerCase.mockRestore();
    }
  });

  it("rejects untrimmed layout names", () => {
    const input = projectInput();
    input.layouts[0]!.name = " Launch ";

    expect(issues(input)).toContainEqual({
      message: "layout name must not have leading or trailing whitespace",
      path: ["layouts", 0, "name"],
    });
  });

  it("scopes screen ids to one layout", () => {
    const input = projectInput();
    input.layouts.push({
      id: "feature",
      name: "Feature",
      mode: "connected",
      screens: [screen("hero")],
    });

    expect(parseProject(input).layouts[1]!.screens[0]!.id).toBe("hero");
  });

  it("prefixes layout-local validation paths", () => {
    const input = projectInput();
    input.layouts[0]!.screens.push({
      ...structuredClone(input.layouts[0]!.screens[0]!),
      elements: [
        {
          id: "duplicate",
          type: "shape" as const,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          kind: "rect" as const,
          fill: "#FFFFFF",
        },
        {
          id: "duplicate",
          type: "shape" as const,
          x: 20,
          y: 0,
          width: 10,
          height: 10,
          kind: "rect" as const,
          fill: "#FFFFFF",
        },
      ],
    });

    expect(issues(input)).toEqual(expect.arrayContaining([
      { message: 'duplicate screen id: "hero"', path: ["layouts", 0, "screens", 1, "id"] },
      {
        message: 'duplicate element id within screen: "duplicate"',
        path: ["layouts", 0, "screens", 1, "elements", 1, "id"],
      },
    ]));
  });
});

describe("design layout lifecycle API", () => {
  it("exports the layout resolver and lifecycle operations", async () => {
    const model = await import("./index.js");

    expect(model).toEqual(expect.objectContaining({
      getLayout: expect.any(Function),
      getPreferredExportLayout: expect.any(Function),
      resolveLayoutReference: expect.any(Function),
      layoutLocales: expect.any(Function),
      layoutPlatforms: expect.any(Function),
      addLayout: expect.any(Function),
      duplicateLayout: expect.any(Function),
      renameLayout: expect.any(Function),
      setLayoutMode: expect.any(Function),
      preferLayout: expect.any(Function),
      removeLayout: expect.any(Function),
    }));
  });

  it("resolves ids, full names, and the preferred fallback", () => {
    const input = projectInput();
    input.layouts.push({
      id: "feature",
      name: "Feature Focus",
      mode: "connected",
      screens: [screen("feature-hero")],
    });
    const project = parseProject(input);

    expect(getLayout(project, "feature").name).toBe("Feature Focus");
    expect(resolveLayoutReference(project, "feature focus").id).toBe("feature");
    expect(resolveLayoutReference(project).id).toBe("launch");
    expect(getPreferredExportLayout(project).id).toBe("launch");
    expect(() => resolveLayoutReference(project, "missing")).toThrow('Unknown layout "missing"');
  });

  it("derives locales and platforms from one layout in first-use order", () => {
    const input = projectInput();
    input.layouts[0]!.screens.push(
      { ...screen("android"), platform: "android", device: "phone", locale: "uk" },
      { ...screen("ipad"), device: "ipad", locale: "en" },
    );
    const layout = parseProject(input).layouts[0]!;

    expect(layoutLocales(layout)).toEqual(["en", "uk"]);
    expect(layoutPlatforms(layout)).toEqual(["apple", "android"]);
  });

  it("appends a clean layout with one screen from supplied settings", () => {
    const project = parseProject(projectInput());
    const result = addLayout(project, {
      name: "  Feature Focus  ",
      mode: "connected",
      screen: {
        platform: "apple",
        device: "iphone",
        locale: "uk",
        direction: "ltr",
        artboard: { width: 1290, height: 2796 },
      },
    });

    expect(result.layout).toMatchObject({
      id: "feature-focus",
      name: "Feature Focus",
      mode: "connected",
    });
    expect(result.layout.screens).toHaveLength(1);
    expect(result.layout.screens[0]).toMatchObject({
      name: "Screen 1",
      platform: "apple",
      device: "iphone",
      locale: "uk",
      artboard: { width: 1290, height: 2796 },
      background: { type: "solid", color: "#FFFFFF" },
      elements: [],
    });
    expect(result.project.layouts.map((layout) => layout.id)).toEqual(["launch", "feature-focus"]);
  });

  it("switches an existing layout mode without changing its content", () => {
    const project = parseProject(projectInput());
    const switched = setLayoutMode(project, "launch", "connected");

    expect(switched.layouts[0]!.mode).toBe("connected");
    expect(switched.layouts[0]!.screens).toEqual(project.layouts[0]!.screens);
    expect(setLayoutMode(switched, "launch", "connected")).toBe(switched);
  });

  it("duplicates content after the source with fresh nested ids and rewritten variants", () => {
    const input = projectInput();
    input.layouts[0]!.screens[0]!.elements = [
      {
        id: "group",
        type: "group",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        children: [
          {
            id: "child",
            type: "shape",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            kind: "rect",
            fill: "#FFFFFF",
          },
        ],
      },
    ] as never;
    input.layouts[0]!.screens.push({
      ...structuredClone(input.layouts[0]!.screens[0]!),
      id: "hero-65",
      variantOf: "hero",
      storeTargetId: "6.5",
    } as never);
    const project = parseProject(input);

    const result = duplicateLayout(project, "launch", "Launch Campaign Copy");
    const [source, copy] = result.project.layouts;
    const sourceIds = source!.screens.map((item) => item.id);
    const copyIds = copy!.screens.map((item) => item.id);

    expect(result.layout).toBe(copy);
    expect(copy).toMatchObject({ name: "Launch Campaign Copy", mode: "isolated" });
    expect(copyIds).not.toEqual(sourceIds);
    expect(copy!.screens[1]!.variantOf).toBe(copy!.screens[0]!.id);
    expect(copy!.screens[0]!.name).toBe(source!.screens[0]!.name);
    expect(copy!.screens[0]!.elements[0]!.id).not.toBe("group");
    expect(copy!.screens[0]!.elements[0]).toMatchObject({ type: "group" });
    const copiedGroup = copy!.screens[0]!.elements[0];
    expect(copiedGroup?.type === "group" ? copiedGroup.children[0]!.id : null).not.toBe("child");
  });

  it("renames with trimming and rejects a normalized duplicate", () => {
    const input = projectInput();
    input.layouts.push({
      id: "feature",
      name: "Feature",
      mode: "isolated",
      screens: [screen("feature")],
    });
    const project = parseProject(input);

    const renamed = renameLayout(project, "feature", "  App Store Launch  ");
    expect(getLayout(renamed, "feature").name).toBe("App Store Launch");
    expect(() => renameLayout(renamed, "feature", "LAUNCH")).toThrow(
      'A layout named "LAUNCH" already exists',
    );
  });

  it("changes the preferred export layout without changing array order", () => {
    const created = addLayout(parseProject(projectInput()), {
      name: "Feature",
      mode: "isolated",
      screen: {
        platform: "apple",
        device: "iphone",
        locale: "en",
        artboard: { width: 1320, height: 2868 },
      },
    }).project;

    const preferred = preferLayout(created, "Feature");
    expect(preferred.preferredExportLayoutId).toBe("feature");
    expect(preferred.layouts.map((layout) => layout.id)).toEqual(["launch", "feature"]);
  });

  it("deletes atomically and replaces a deleted preferred layout with next then previous", () => {
    let project = parseProject(projectInput());
    for (const name of ["Feature", "Seasonal"]) {
      project = addLayout(project, {
        name,
        mode: "isolated",
        screen: {
          platform: "apple",
          device: "iphone",
          locale: "en",
          artboard: { width: 1320, height: 2868 },
        },
      }).project;
    }

    const first = removeLayout(project, "launch");
    expect(first.project.preferredExportLayoutId).toBe("feature");
    expect(first.layout.id).toBe("feature");

    const preferredLast = preferLayout(first.project, "seasonal");
    const second = removeLayout(preferredLast, "seasonal");
    expect(second.project.preferredExportLayoutId).toBe("feature");
    expect(second.layout.id).toBe("feature");
  });

  it("refuses to delete the last layout", () => {
    expect(() => removeLayout(parseProject(projectInput()), "launch"))
      .toThrow("Cannot remove the last layout");
  });

  it("resolves and mutates screens only inside the selected layout", () => {
    const input = projectInput();
    input.layouts.push({
      id: "feature",
      name: "Feature",
      mode: "isolated",
      screens: [screen("hero")],
    });
    const project = parseProject(input);

    expect(getScreen(project, "feature", "hero").name).toBe("Hero");

    const updated = addScreenToProject(project, "feature", {
      platform: "apple",
      device: "iphone",
      locale: "en",
      artboard: { width: 1320, height: 2868 },
      name: "Details",
    });

    expect(updated.layouts[0]).toEqual(project.layouts[0]);
    expect(updated.layouts[0]!.screens).toHaveLength(1);
    expect(updated.layouts[1]!.screens.map((item) => item.name)).toEqual(["Hero", "Details"]);
  });
});
