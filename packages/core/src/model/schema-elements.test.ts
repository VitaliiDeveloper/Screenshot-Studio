// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import {
  DEVICE_FRAME_IDS,
  Element,
  getScreen,
  parseProject,
  ProjectValidationError,
} from "./index.js";
import { validProject } from "./schema-test-fixtures.js";

describe("element name (slice 4)", () => {
  it("accepts an element with an optional name", () => {
    const p = validProject();
    (p.layouts[0]!.screens[0]!.elements[0] as Record<string, unknown>).name = "Big headline";
    expect(() => parseProject(p)).not.toThrow();
    expect(parseProject(p).layouts[0]!.screens[0]!.elements[0]!.name).toBe("Big headline");
  });

  it("still accepts an element with no name (v1 stays valid)", () => {
    const p = validProject();
    delete (p.layouts[0]!.screens[0]!.elements[0] as Record<string, unknown>).name;
    expect(() => parseProject(p)).not.toThrow();
    expect(parseProject(p).layouts[0]!.screens[0]!.elements[0]!.name).toBeUndefined();
  });
});

describe("element theme role", () => {
  it("accepts a known optional role", () => {
    const p = validProject();
    (p.layouts[0]!.screens[0]!.elements[0] as Record<string, unknown>).role = "heading";
    const parsed = parseProject(p).layouts[0]!.screens[0]!.elements[0]!;
    if (parsed.type === "group") throw new Error("expected leaf fixture");
    expect(parsed.role).toBe("heading");
  });

  it("rejects an unknown role", () => {
    const p = validProject();
    (p.layouts[0]!.screens[0]!.elements[0] as Record<string, unknown>).role = "hero";
    expect(() => parseProject(p)).toThrow(ProjectValidationError);
  });
});

describe("text vertical alignment", () => {
  it("accepts the strict vertical alignment values without invalidating older documents", () => {
    const legacy = validProject();
    expect(parseProject(legacy).layouts[0]!.screens[0]!.elements[0]).not.toHaveProperty("verticalAlign");

    const project = validProject();
    (project.layouts[0]!.screens[0]!.elements[0] as Record<string, unknown>).verticalAlign = "middle";
    expect(parseProject(project).layouts[0]!.screens[0]!.elements[0]).toMatchObject({ verticalAlign: "middle" });
  });

  it("rejects an unknown vertical alignment", () => {
    const project = validProject();
    (project.layouts[0]!.screens[0]!.elements[0] as Record<string, unknown>).verticalAlign = "center";
    expect(() => parseProject(project)).toThrow(ProjectValidationError);
  });
});

describe("getScreen", () => {
  it("returns a screen by id", () => {
    const project = parseProject(validProject());
    expect(getScreen(project, "default", "s1").name).toBe("Screen 1");
  });

  it("throws for an unknown screen id", () => {
    const project = parseProject(validProject());
    expect(() => getScreen(project, "default", "nope")).toThrow(/not found/);
  });
});

describe("styling literals", () => {
  it("accepts strict bounded text shadow", () => {
    const text = validProject().layouts[0]!.screens[0]!.elements[0]!;
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

  it("accepts bounded blur for screenshots, images, and device-frame content", () => {
    const transform = {
      x: 0, y: 0, width: 100, height: 200,
      rotation: 0, opacity: 1, locked: false, visible: true,
    };
    const media = [
      { ...transform, id: "shot", type: "screenshot", assetUrl: "assets/shot.png", blur: 12 },
      { ...transform, id: "image", type: "image", assetUrl: "assets/image.png", blur: 40 },
      { ...transform, id: "frame", type: "device-frame", deviceType: "iphone", blur: 8 },
    ];

    for (const element of media) {
      expect(Element.parse(element)).toMatchObject({ blur: element.blur });
      expect(() => Element.parse({ ...element, blur: -1 })).toThrow();
      expect(() => Element.parse({ ...element, blur: 40.1 })).toThrow();
    }
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
    const expectedDeviceFrameIds = [
      "iphone", "android-phone", "tablet", "desktop", "laptop", "browser", "tv", "watch",
      "phone-modern-dark", "phone-modern-light", "phone-punch-hole-dark", "phone-outline",
      "frameless-phone", "tablet-rounded-dark", "tablet-rounded-light", "tablet-outline",
      "frameless-tablet", "browser-light", "browser-dark", "browser-minimal", "frameless-browser",
      "laptop-silver", "laptop-dark", "display-stand", "display-minimal", "tv-flat",
      "watch-rounded", "watch-square", "frameless-watch", "foldable", "automotive-display",
      "xr-viewport",
    ] as const;
    expect(DEVICE_FRAME_IDS).toEqual(expectedDeviceFrameIds);
    for (const deviceType of expectedDeviceFrameIds) {
      expect(Element.parse({ ...base, deviceType })).toMatchObject({ deviceType });
    }
  });

  it("does not persist catalog presentation or renderer recipe metadata", () => {
    for (const extra of ["label", "group", "tags", "finish", "recommendedFor", "legacy", "recipe"]) {
      expect(() => Element.parse({ ...base, [extra]: "catalog-only" })).toThrow();
    }
  });

  it("rejects an unknown fit", () => {
    expect(() => Element.parse({ ...base, fit: "stretch" })).toThrow();
  });

  it("rejects an empty assetUrl", () => {
    expect(() => Element.parse({ ...base, assetUrl: "" })).toThrow();
  });

  it("accepts an empty mockup placeholder without an asset field", () => {
    const { assetUrl: _assetUrl, ...placeholder } = base;
    expect(Element.parse(placeholder)).not.toHaveProperty("assetUrl");
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
    const original = project.layouts[0]!.screens[0]!.elements[0]!;
    project.layouts[0]!.screens[0]!.elements.push({
      ...group,
      children: [{ ...child, id: original.id }],
    } as never);
    expect(() => parseProject(project)).toThrow(/duplicate element id/);
  });
});
