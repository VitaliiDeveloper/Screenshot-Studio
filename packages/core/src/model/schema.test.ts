import { describe, it, expect } from "vitest";
import { parseProject, ProjectValidationError, getScreen, SCHEMA_VERSION, Element, Screen } from "./index.js";

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
    expect(parseProject(p).screens[0]!.elements[0]!.role).toBe("heading");
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
