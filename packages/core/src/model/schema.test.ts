// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { parseProject, migrateToCurrent, ProjectValidationError, getScreen, SCHEMA_VERSION, Element, Screen } from "./index.js";

function validProject() {
  return {
    meta: { name: "Sample", schemaVersion: SCHEMA_VERSION },
    mode: "isolated",
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

function setRawFonts(project: ReturnType<typeof validProject>, fonts: unknown[]) {
  (project as { fonts: unknown[] }).fonts = fonts;
}

describe("parseProject", () => {
  it("accepts a valid project and applies element defaults", () => {
    const project = parseProject(validProject());
    const el = project.screens[0]!.elements[0]!;
    expect(el.opacity).toBe(1);
    expect(el.visible).toBe(true);
    expect(el.rotation).toBe(0);
  });

  it("accepts connected mode", () => {
    const raw = validProject();
    raw.mode = "connected";
    expect(parseProject(raw).mode).toBe("connected");
  });

  it("migrates valid v1 input sequentially to isolated current schema", () => {
    const raw = validProject() as Record<string, unknown>;
    delete raw.mode;
    (raw.meta as Record<string, unknown>).schemaVersion = 1;
    const project = parseProject(raw);
    expect(project.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(project.mode).toBe("isolated");
  });

  it("migrates valid v2 input losslessly to current schema", () => {
    const raw = validProject();
    raw.meta.schemaVersion = 2 as typeof SCHEMA_VERSION;
    const project = parseProject(raw);
    expect(project.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(project.screens[0]!.elements[0]).toMatchObject({ id: "t1", type: "text", content: "Hello" });
  });

  it("does not bless a group mislabeled as schema v2", () => {
    const raw = validProject();
    raw.meta.schemaVersion = 2 as typeof SCHEMA_VERSION;
    raw.screens[0]!.elements = [{
      id: "group", type: "group", x: 0, y: 0, width: 100, height: 50,
      children: [{
        id: "shape", type: "shape", x: 0, y: 0, width: 100, height: 50,
        kind: "rect", fill: "#FF0000",
      }],
    } as never];
    expect(() => parseProject(raw)).toThrow(ProjectValidationError);
  });

  it("migrates valid v3 input losslessly to current schema", () => {
    const raw = validProject();
    raw.meta.schemaVersion = 3 as typeof SCHEMA_VERSION;
    const project = parseProject(raw);
    expect(project.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(project.screens[0]!.elements[0]).toMatchObject({ id: "t1", type: "text" });
  });

  it("does not bless an image mislabeled as schema v3", () => {
    const raw = validProject();
    raw.meta.schemaVersion = 3 as typeof SCHEMA_VERSION;
    raw.screens[0]!.elements = [{
      id: "image", type: "image", x: 0, y: 0, width: 100, height: 50,
      assetUrl: "assets/image.png",
    } as never];
    expect(() => parseProject(raw)).toThrow(ProjectValidationError);
  });

  it("does not bless a grouped image mislabeled as schema v3", () => {
    const raw = validProject();
    raw.meta.schemaVersion = 3 as typeof SCHEMA_VERSION;
    raw.screens[0]!.elements = [{
      id: "group", type: "group", x: 0, y: 0, width: 100, height: 50,
      children: [{
        id: "image", type: "image", x: 0, y: 0, width: 100, height: 50,
        assetUrl: "assets/image.png",
      }],
    } as never];
    expect(() => parseProject(raw)).toThrow(ProjectValidationError);
  });

  it("migrates valid v4 input losslessly to current schema", () => {
    const raw = validProject();
    raw.meta.schemaVersion = 4 as typeof SCHEMA_VERSION;
    const project = parseProject(raw);
    expect(project.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(project.screens[0]!.elements[0]).toMatchObject({ id: "t1", type: "text" });
  });

  it("migrates valid v5 input losslessly to current", () => {
    const raw = validProject();
    raw.meta.schemaVersion = 5 as typeof SCHEMA_VERSION;
    const before = structuredClone(raw.screens);
    const migrated = migrateToCurrent(raw) as typeof raw;
    expect(migrated.meta.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.screens).toEqual(before);
  });

  it("does not bless v6 variant fields mislabeled as schema v5", () => {
    const raw = validProject();
    raw.meta.schemaVersion = 5 as typeof SCHEMA_VERSION;
    Object.assign(raw.screens[0]!, { variantOf: "root", storeTargetId: "6.5" });
    expect(() => parseProject(raw)).toThrow(ProjectValidationError);
  });

  it("migrates valid solid-background v6 input losslessly to current", () => {
    const raw = validProject();
    raw.meta.schemaVersion = 6 as typeof SCHEMA_VERSION;
    const before = structuredClone(raw.screens);
    const migrated = migrateToCurrent(raw) as typeof raw;
    expect(migrated.screens).toEqual(before);
    const project = parseProject(migrated);
    expect(project.meta.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("does not bless a gradient background mislabeled as schema v6", () => {
    const raw = validProject() as unknown as Record<string, unknown>;
    (raw.meta as Record<string, unknown>).schemaVersion = 6;
    const screens = raw.screens as Array<Record<string, unknown>>;
    screens[0]!.background = {
      type: "linear-gradient", from: "#000000", to: "#FFFFFF", angle: 45,
    };
    expect(() => parseProject(raw)).toThrow(ProjectValidationError);
  });

  it("migrates valid v7 input and rejects crop fields mislabeled as v7", () => {
    const valid = validProject();
    valid.meta.schemaVersion = 7 as typeof SCHEMA_VERSION;
    expect(parseProject(valid).meta.schemaVersion).toBe(SCHEMA_VERSION);

    const mislabeled = validProject() as unknown as Record<string, unknown>;
    (mislabeled.meta as Record<string, unknown>).schemaVersion = 7;
    const screen = (mislabeled.screens as Array<Record<string, unknown>>)[0]!;
    const element = (screen.elements as Array<Record<string, unknown>>)[0]!;
    Object.assign(element, {
      type: "screenshot", assetUrl: "assets/shot.png", fit: "cover", crop: { x: 0.2, y: 0.8, zoom: 2 },
    });
    delete element.content;
    delete element.fontFamily;
    delete element.size;
    delete element.color;
    expect(() => parseProject(mislabeled)).toThrow(ProjectValidationError);
  });

  it("accepts strict linear-gradient and image backgrounds with defaults", () => {
    const gradient = validProject() as unknown as Record<string, unknown>;
    const gradientScreen = (gradient.screens as Array<Record<string, unknown>>)[0]!;
    gradientScreen.background = { type: "linear-gradient", from: "#112233", to: "#AABBCC" };
    expect(parseProject(gradient).screens[0]!.background).toEqual({
      type: "linear-gradient", from: "#112233", to: "#AABBCC", angle: 0,
    });

    const image = validProject() as unknown as Record<string, unknown>;
    const imageScreen = (image.screens as Array<Record<string, unknown>>)[0]!;
    imageScreen.background = { type: "image", assetUrl: "assets/background.png" };
    expect(parseProject(image).screens[0]!.background).toEqual({
      type: "image", assetUrl: "assets/background.png", fit: "cover", color: "#000000",
    });
  });

  it("rejects invalid background values and unknown fields", () => {
    for (const background of [
      { type: "linear-gradient", from: "#000000", to: "#FFFFFF", angle: 361 },
      { type: "image", assetUrl: "", fit: "cover", color: "#000000" },
      { type: "solid", color: "#000000", opacity: 0.5 },
    ]) {
      const raw = validProject() as unknown as Record<string, unknown>;
      (raw.screens as Array<Record<string, unknown>>)[0]!.background = background;
      expect(() => parseProject(raw)).toThrow(ProjectValidationError);
    }
  });

  it("validates root and store-target variant relationships", () => {
    const raw = validProject();
    const variant = structuredClone(raw.screens[0]!);
    variant.id = "hero-65";
    variant.artboard = { width: 1284, height: 2778 };
    Object.assign(variant, {
      variantOf: raw.screens[0]!.id,
      storeTargetId: "6.5",
    });
    raw.screens.push(variant);
    expect(parseProject(raw).screens[1]).toMatchObject({
      variantOf: raw.screens[0]!.id,
      storeTargetId: "6.5",
    });

    const missingTarget = structuredClone(raw);
    delete (missingTarget.screens[1]! as unknown as Record<string, unknown>).storeTargetId;
    expect(() => parseProject(missingTarget)).toThrow(/variantOf and storeTargetId/);

    const duplicate = structuredClone(raw);
    duplicate.screens.push({ ...structuredClone(duplicate.screens[1]!), id: "hero-65-copy" });
    expect(() => parseProject(duplicate)).toThrow(/duplicate store target variant/);
  });

  it("rejects duplicate screen ids before resolving variant references", () => {
    const raw = validProject();
    raw.screens.push(structuredClone(raw.screens[0]!));
    expect(() => parseProject(raw)).toThrow(/duplicate screen id/);
  });

  it("does not bless top-level or grouped icons mislabeled as schema v4", () => {
    for (const grouped of [false, true]) {
      const raw = validProject();
      raw.meta.schemaVersion = 4 as typeof SCHEMA_VERSION;
      const icon = {
        id: "icon", type: "icon", x: 0, y: 0, width: 100, height: 100,
        icon: "star", color: "#FF0000",
      };
      raw.screens[0]!.elements = grouped ? [{
        id: "group", type: "group", x: 0, y: 0, width: 100, height: 100,
        children: [icon],
      } as never] : [icon as never];
      expect(() => parseProject(raw)).toThrow(ProjectValidationError);
    }
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

describe("FontAsset", () => {
  it("accepts a file-backed uploaded font", () => {
    const p = validProject();
    setRawFonts(p, [{ family: "Pacifico", source: "uploaded", path: "assets/fonts/Pacifico-Regular.ttf", weight: 400 }]);
    expect(() => parseProject(p)).not.toThrow();
  });

  it("accepts google as file provenance", () => {
    const p = validProject();
    setRawFonts(p, [{ family: "Inter", source: "google", path: "assets/fonts/inter-400.ttf", weight: 400 }]);
    expect(() => parseProject(p)).not.toThrow();
  });

  it("rejects legacy base64 font data", () => {
    const p = validProject();
    setRawFonts(p, [{ family: "Pacifico", source: "uploaded", data: "AAAA", weight: 400 }]);
    expect(() => parseProject(p)).toThrow(ProjectValidationError);
  });

  it("rejects duplicate font family and weight", () => {
    const p = validProject();
    setRawFonts(p, [
      { family: "Inter", source: "uploaded", path: "assets/fonts/inter-a.ttf", weight: 400 },
      { family: "Inter", source: "google", path: "assets/fonts/inter-b.ttf", weight: 400 },
    ]);
    expect(() => parseProject(p)).toThrow(ProjectValidationError);
  });
});

describe("element name (slice 4)", () => {
  it("accepts an element with an optional name", () => {
    const p = validProject();
    (p.screens[0]!.elements[0] as Record<string, unknown>).name = "Big headline";
    expect(() => parseProject(p)).not.toThrow();
    expect(parseProject(p).screens[0]!.elements[0]!.name).toBe("Big headline");
  });

  it("still accepts an element with no name (v1 stays valid)", () => {
    const p = validProject();
    delete (p.screens[0]!.elements[0] as Record<string, unknown>).name;
    expect(() => parseProject(p)).not.toThrow();
    expect(parseProject(p).screens[0]!.elements[0]!.name).toBeUndefined();
  });
});

describe("element theme role", () => {
  it("accepts a known optional role", () => {
    const p = validProject();
    (p.screens[0]!.elements[0] as Record<string, unknown>).role = "heading";
    const parsed = parseProject(p).screens[0]!.elements[0]!;
    if (parsed.type === "group") throw new Error("expected leaf fixture");
    expect(parsed.role).toBe("heading");
  });

  it("rejects an unknown role", () => {
    const p = validProject();
    (p.screens[0]!.elements[0] as Record<string, unknown>).role = "hero";
    expect(() => parseProject(p)).toThrow(ProjectValidationError);
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

describe("Phase 9 styling literals", () => {
  it("accepts strict bounded text shadow", () => {
    const text = validProject().screens[0]!.elements[0]!;
    expect(Element.parse({
      ...text,
      shadow: { color: "#000000", blur: 12, offsetX: 2, offsetY: 4, opacity: 0.5 },
    })).toMatchObject({ shadow: { blur: 12, opacity: 0.5 } });
    expect(() => Element.parse({
      ...text,
      shadow: { color: "#000000", blur: 101, offsetX: 0, offsetY: 0, opacity: 1 },
    })).toThrow();
  });

  it("accepts ellipse, gradient, and stroke while rejecting unbounded or unknown paint", () => {
    const shape = {
      id: "shape", type: "shape", x: 0, y: 0, width: 100, height: 80,
      kind: "ellipse", fill: "#123456",
      gradient: { from: "#000000", to: "#FFFFFF", angle: 45 },
      stroke: { color: "#FF00FF", width: 4 },
    };
    expect(Element.parse(shape)).toMatchObject(shape);
    expect(() => Element.parse({ ...shape, kind: "blob" })).toThrow();
    expect(() => Element.parse({ ...shape, stroke: { color: "#FFFFFF", width: 0 } })).toThrow();
    expect(() => Element.parse({ ...shape, gradient: { ...shape.gradient, stops: [] } })).toThrow();
  });

  it("does not bless v9 styling fields mislabeled as schema v8", () => {
    const raw = validProject() as unknown as Record<string, unknown>;
    (raw.meta as Record<string, unknown>).schemaVersion = 8;
    const screen = (raw.screens as Array<Record<string, unknown>>)[0]!;
    const element = (screen.elements as Array<Record<string, unknown>>)[0]!;
    element.shadow = { color: "#000000", blur: 4, offsetX: 0, offsetY: 2, opacity: 0.5 };
    expect(() => parseProject(raw)).toThrow(ProjectValidationError);
  });
});

describe("ScreenshotElement", () => {
  const base = {
    id: "s1", type: "screenshot", x: 0, y: 0, width: 100, height: 200,
    assetUrl: "assets/shot.png",
  };

  it("parses a valid screenshot with defaults", () => {
    const parsed = Element.parse(base);
    expect(parsed).toMatchObject({ type: "screenshot", fit: "cover", cornerRadius: 0 });
  });

  it("accepts fit contain and a corner radius", () => {
    expect(Element.parse({ ...base, fit: "contain", cornerRadius: 24 }))
      .toMatchObject({ fit: "contain", cornerRadius: 24 });
  });

  it("accepts bounded normalized crop and applies crop defaults", () => {
    expect(Element.parse({ ...base, crop: {} })).toMatchObject({
      crop: { x: 0.5, y: 0.5, zoom: 1 },
    });
    expect(Element.parse({ ...base, crop: { x: 0, y: 1, zoom: 4 } })).toMatchObject({
      crop: { x: 0, y: 1, zoom: 4 },
    });
    expect(() => Element.parse({ ...base, crop: { x: -0.1, y: 0.5, zoom: 1 } })).toThrow();
    expect(() => Element.parse({ ...base, crop: { x: 0.5, y: 0.5, zoom: 4.1 } })).toThrow();
  });

  it("rejects an unknown fit", () => {
    expect(() => Element.parse({ ...base, fit: "stretch" })).toThrow();
  });

  it("rejects an empty assetUrl", () => {
    expect(() => Element.parse({ ...base, assetUrl: "" })).toThrow();
  });

  it("rejects an unknown key (strict)", () => {
    expect(() => Element.parse({ ...base, bogus: 1 })).toThrow();
  });
});

describe("ImageElement (schema v4)", () => {
  const base = {
    id: "image-1", type: "image", x: 0, y: 0, width: 100, height: 200,
    assetUrl: "assets/decor.png",
  };

  it("parses a valid decorative image with non-cropping defaults", () => {
    expect(Element.parse(base)).toMatchObject({ type: "image", fit: "contain", cornerRadius: 0 });
  });

  it("accepts deterministic cover and corner radius", () => {
    expect(Element.parse({ ...base, fit: "cover", cornerRadius: 18 }))
      .toMatchObject({ fit: "cover", cornerRadius: 18 });
  });

  it("rejects invalid fit, empty assets, negative radius, and unknown fields", () => {
    expect(() => Element.parse({ ...base, fit: "stretch" })).toThrow();
    expect(() => Element.parse({ ...base, assetUrl: "" })).toThrow();
    expect(() => Element.parse({ ...base, cornerRadius: -1 })).toThrow();
    expect(() => Element.parse({ ...base, bogus: true })).toThrow();
  });
});

describe("IconElement (schema v5)", () => {
  const base = {
    id: "icon-1", type: "icon", x: 0, y: 0, width: 100, height: 100,
    icon: "star", color: "#3B82F6",
  };

  it("accepts a trusted built-in icon with a positive stroke default", () => {
    expect(Element.parse(base)).toMatchObject({ icon: "star", color: "#3B82F6", strokeWidth: 2 });
  });

  it("accepts every registered icon id", () => {
    for (const icon of ["check", "heart", "sparkles", "star"]) {
      expect(Element.parse({ ...base, icon })).toMatchObject({ icon });
    }
  });

  it("rejects unknown ids, raw SVG, invalid colours, and invalid strokes", () => {
    expect(() => Element.parse({ ...base, icon: "external" })).toThrow();
    expect(() => Element.parse({ ...base, svg: "<svg onload='alert(1)'/>" })).toThrow();
    expect(() => Element.parse({ ...base, color: "red" })).toThrow();
    expect(() => Element.parse({ ...base, strokeWidth: 0 })).toThrow();
  });
});

describe("DeviceFrameElement", () => {
  const base = {
    id: "df1", type: "device-frame", x: 0, y: 0, width: 500, height: 1000,
    deviceType: "iphone", assetUrl: "assets/shot.png",
  };

  it("parses a valid device-frame with defaults", () => {
    const parsed = Element.parse(base);
    expect(parsed).toMatchObject({ type: "device-frame", deviceType: "iphone", fit: "cover" });
  });

  it("accepts fit contain", () => {
    expect(Element.parse({ ...base, fit: "contain" })).toMatchObject({ fit: "contain" });
  });

  it("rejects an unknown deviceType", () => {
    expect(() => Element.parse({ ...base, deviceType: "android" })).toThrow();
  });

  it("accepts every trusted built-in frame preset", () => {
    for (const deviceType of ["iphone", "android-phone", "tablet", "desktop", "tv", "watch"] as const) {
      expect(Element.parse({ ...base, deviceType })).toMatchObject({ deviceType });
    }
  });

  it("does not bless non-iPhone presets mislabeled as schema v9", () => {
    const raw = validProject() as unknown as Record<string, unknown>;
    (raw.meta as Record<string, unknown>).schemaVersion = 9;
    const screen = (raw.screens as Array<Record<string, unknown>>)[0]!;
    screen.elements = [{ ...base, deviceType: "tablet" }];
    expect(() => parseProject(raw)).toThrow(ProjectValidationError);
  });

  it("rejects an unknown fit", () => {
    expect(() => Element.parse({ ...base, fit: "stretch" })).toThrow();
  });

  it("rejects an empty assetUrl", () => {
    expect(() => Element.parse({ ...base, assetUrl: "" })).toThrow();
  });

  it("rejects an unknown key (strict)", () => {
    expect(() => Element.parse({ ...base, bogus: 1 })).toThrow();
  });
});

describe("GroupElement (schema v3)", () => {
  const child = {
    id: "child", type: "shape", x: 0, y: 0, width: 100, height: 50,
    kind: "rect", fill: "#FF0000",
  };
  const group = {
    id: "group", type: "group", x: 10, y: 20, width: 100, height: 50,
    children: [child],
  };

  it("accepts one-level groups and applies transform defaults", () => {
    expect(Element.parse(group)).toMatchObject({
      type: "group", rotation: 0, opacity: 1, locked: false, visible: true,
      children: [{ type: "shape", rotation: 0, opacity: 1, locked: false, visible: true }],
    });
  });

  it("rejects empty or nested groups", () => {
    expect(() => Element.parse({ ...group, children: [] })).toThrow();
    expect(() => Element.parse({ ...group, children: [group] })).toThrow();
  });

  it("rejects group-level theme roles and unknown fields", () => {
    expect(() => Element.parse({ ...group, role: "accent" })).toThrow();
    expect(() => Element.parse({ ...group, clip: true })).toThrow();
  });

  it("requires element ids to be unique across one screen tree", () => {
    const project = validProject();
    const original = project.screens[0]!.elements[0]!;
    project.screens[0]!.elements.push({
      ...group,
      children: [{ ...child, id: original.id }],
    } as never);
    expect(() => parseProject(project)).toThrow(/duplicate element id/);
  });
});

describe("Screen platform/device union", () => {
  const baseScreen = {
    id: "s1",
    name: "S",
    locale: "en",
    artboard: { width: 1320, height: 2868 },
    background: { type: "solid", color: "#000000" },
    elements: [],
  };

  it("accepts apple/ipad", () => {
    const r = Screen.safeParse({
      ...baseScreen,
      platform: "apple",
      device: "ipad",
      artboard: { width: 2064, height: 2752 },
    });
    expect(r.success).toBe(true);
  });

  it("accepts android/phone", () => {
    const r = Screen.safeParse({
      ...baseScreen,
      platform: "android",
      device: "phone",
      artboard: { width: 1080, height: 1920 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects apple/phone", () => {
    expect(Screen.safeParse({ ...baseScreen, platform: "apple", device: "phone" }).success).toBe(false);
  });

  it("rejects android/iphone", () => {
    expect(Screen.safeParse({ ...baseScreen, platform: "android", device: "iphone" }).success).toBe(false);
  });
});

describe("Screen direction", () => {
  it("defaults an existing v1 screen to ltr", () => {
    expect(parseProject(validProject()).screens[0]!.direction).toBe("ltr");
  });

  it("accepts an explicit rtl direction", () => {
    const project = validProject();
    (project.screens[0] as Record<string, unknown>).direction = "rtl";

    expect(parseProject(project).screens[0]!.direction).toBe("rtl");
  });

  it("rejects an unknown direction", () => {
    const project = validProject();
    (project.screens[0] as Record<string, unknown>).direction = "auto";

    expect(() => parseProject(project)).toThrow(ProjectValidationError);
  });

  it("requires every screen in one locale set to share a direction", () => {
    const project = validProject();
    (project.screens[0] as Record<string, unknown>).direction = "ltr";
    project.screens.push({
      ...structuredClone(project.screens[0]!),
      id: "s2",
      name: "Screen 2",
    });
    (project.screens[1] as Record<string, unknown>).direction = "rtl";

    expect(() => parseProject(project)).toThrow(ProjectValidationError);
  });
});

describe("Project.platforms manifest", () => {
  function androidProject() {
    const p = validProject();
    p.platforms = ["android"];
    p.screens[0]!.platform = "android";
    p.screens[0]!.device = "phone";
    p.screens[0]!.artboard = { width: 1080, height: 1920 };
    return p;
  }

  it("accepts an android/phone project", () => {
    expect(() => parseProject(androidProject())).not.toThrow();
  });

  it.each([
    ["apple", "ipad"],
    ["apple", "macos"],
    ["apple", "tvos"],
    ["apple", "watchos"],
    ["windows", "desktop"],
  ] as const)("accepts %s/%s projects", (platform, device) => {
    const project = validProject();
    project.platforms = [platform];
    project.screens[0]!.platform = platform;
    project.screens[0]!.device = device;
    expect(() => parseProject(project)).not.toThrow();
  });

  it("rejects a duplicate platform", () => {
    const bad = validProject();
    bad.platforms = ["apple", "apple"];
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("rejects a declared platform with no screen", () => {
    const bad = validProject();
    bad.platforms = ["apple", "android"]; // only an apple screen exists
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("rejects a screen whose platform is not declared", () => {
    const bad = androidProject();
    bad.platforms = ["apple"]; // screen is android
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });
});

describe("Project.locales manifest", () => {
  it("accepts a project whose locale manifest matches its screens", () => {
    const project = validProject();
    project.locales = ["en", "uk"];
    project.screens.push({
      ...structuredClone(project.screens[0]!),
      id: "s2",
      name: "Screen 2",
      locale: "uk",
    });

    expect(() => parseProject(project)).not.toThrow();
  });

  it("rejects a duplicate locale", () => {
    const bad = validProject();
    bad.locales = ["en", "en"];

    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("rejects a declared locale with no screen", () => {
    const bad = validProject();
    bad.locales = ["en", "uk"];

    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("rejects a screen whose locale is not declared", () => {
    const bad = validProject();
    bad.screens[0]!.locale = "uk";

    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });
});
