// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import {
  DEFAULT_FONT_WEIGHT,
  Element,
  FONT_WEIGHT_MAX,
  FONT_WEIGHT_MIN,
  FONT_WEIGHT_STEP,
  FontWeight,
  getScreen,
  parseProject,
  Project,
  ProjectValidationError,
  SCHEMA_VERSION,
  Screen,
} from "./index.js";

function validProject() {
  return {
    meta: { name: "Sample", schemaVersion: SCHEMA_VERSION },
    fonts: [],
    preferredExportLayoutId: "default",
    layouts: [{
      id: "default",
      name: "Default",
      mode: "isolated",
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
    }],
  };
}

function setRawFonts(project: ReturnType<typeof validProject>, fonts: unknown[]) {
  (project as { fonts: unknown[] }).fonts = fonts;
}

const LEGACY_SCREEN_FAMILIES = [
  ["apple", "iphone"],
  ["apple", "ipad"],
  ["apple", "macos"],
  ["apple", "tvos"],
  ["apple", "watchos"],
  ["android", "phone"],
  ["android", "tablet-7"],
  ["android", "tablet-10"],
  ["windows", "desktop"],
  ["web", "desktop"],
  ["web", "laptop"],
  ["web", "tablet"],
  ["web", "mobile"],
] as const;

const LEGACY_DEVICE_FRAME_IDS = [
  "iphone", "android-phone", "tablet", "desktop", "laptop", "browser", "tv", "watch",
] as const;

describe("project resource paths", () => {
  const transform = { x: 0, y: 0, width: 100, height: 200 };

  it("accepts portable resource paths across every persisted field family", () => {
    const project = validProject();
    (project.meta as Record<string, unknown>).appIcon = "assets/App Icon Привіт.png";
    setRawFonts(project, [
      { family: "Inter", source: "uploaded", path: "assets/fonts/Inter Привіт.ttf", weight: 400 },
    ]);

    const screen = project.layouts[0]!.screens[0]! as unknown as {
      background: unknown;
      elements: unknown[];
    };
    screen.background = { type: "image", assetUrl: "assets/backgrounds/Launch image 1.png" };
    screen.elements = [
      { id: "shot", type: "screenshot", ...transform, assetUrl: "assets/shot.png" },
      { id: "image", type: "image", ...transform, assetUrl: "assets/decor.png" },
      {
        id: "frame",
        type: "device-frame",
        ...transform,
        deviceType: "iphone",
        assetUrl: "assets/framed-shot.png",
      },
      {
        id: "group",
        type: "group",
        ...transform,
        children: [
          { id: "grouped-image", type: "image", ...transform, assetUrl: "assets/Група.png" },
        ],
      },
    ];

    expect(Project.safeParse(project).success).toBe(true);
  });

  const unsafeCases: Array<{
    field: string;
    value: string;
    expectedPath: Array<string | number>;
    mutate: (project: ReturnType<typeof validProject>, value: string) => void;
  }> = [
    {
      field: "meta.appIcon",
      value: "../icon.png",
      expectedPath: ["meta", "appIcon"],
      mutate(project, value) {
        (project.meta as Record<string, unknown>).appIcon = value;
      },
    },
    {
      field: "background.assetUrl",
      value: "/tmp/background.png",
      expectedPath: ["layouts", 0, "screens", 0, "background", "assetUrl"],
      mutate(project, value) {
        (project.layouts[0]!.screens[0]! as unknown as { background: unknown }).background = {
          type: "image",
          assetUrl: value,
        };
      },
    },
    {
      field: "screenshot.assetUrl",
      value: "https://example.com/shot.png",
      expectedPath: ["layouts", 0, "screens", 0, "elements", 0, "assetUrl"],
      mutate(project, value) {
        (project.layouts[0]!.screens[0]! as unknown as { elements: unknown[] }).elements = [
          { id: "shot", type: "screenshot", ...transform, assetUrl: value },
        ];
      },
    },
    {
      field: "grouped image.assetUrl",
      value: "assets/../decor.png",
      expectedPath: ["layouts", 0, "screens", 0, "elements", 0, "children", 0, "assetUrl"],
      mutate(project, value) {
        (project.layouts[0]!.screens[0]! as unknown as { elements: unknown[] }).elements = [
          {
            id: "group",
            type: "group",
            ...transform,
            children: [
              { id: "grouped-image", type: "image", ...transform, assetUrl: value },
            ],
          },
        ];
      },
    },
    {
      field: "device-frame.assetUrl",
      value: "file:assets/shot.png",
      expectedPath: ["layouts", 0, "screens", 0, "elements", 0, "assetUrl"],
      mutate(project, value) {
        (project.layouts[0]!.screens[0]! as unknown as { elements: unknown[] }).elements = [
          {
            id: "frame",
            type: "device-frame",
            ...transform,
            deviceType: "iphone",
            assetUrl: value,
          },
        ];
      },
    },
    {
      field: "fonts.path",
      value: "C:\\fonts\\inter.ttf",
      expectedPath: ["fonts", 0, "path"],
      mutate(project, value) {
        setRawFonts(project, [
          { family: "Inter", source: "uploaded", path: value, weight: 400 },
        ]);
      },
    },
  ];

  it.each(unsafeCases)("rejects unsafe $field at its exact issue path", ({ value, expectedPath, mutate }) => {
    const project = validProject();
    mutate(project, value);

    const result = Project.safeParse(project);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map(({ message, path }) => ({ message, path }))).toEqual([{
      message: "expected a portable project-relative path",
      path: expectedPath,
    }]);
  });
});

describe("Project validation issue contracts", () => {
  const cases = [
    {
      category: "screen variants",
      mutate(project: ReturnType<typeof validProject>) {
        project.layouts[0]!.screens.push({
          ...structuredClone(project.layouts[0]!.screens[0]!),
          id: "s2",
          variantOf: "s1",
        } as never);
      },
      expected: [{
        message: "variantOf requires storeTargetId",
        path: ["layouts", 0, "screens", 1],
      }],
    },
    {
      category: "locale direction",
      mutate(project: ReturnType<typeof validProject>) {
        project.layouts[0]!.screens.push({
          ...structuredClone(project.layouts[0]!.screens[0]!),
          id: "s2",
          direction: "rtl",
        } as never);
      },
      expected: [{
        message: 'all screens in locale "en" must use direction "ltr"',
        path: ["layouts", 0, "screens", 1, "direction"],
      }],
    },
    {
      category: "element ids",
      mutate(project: ReturnType<typeof validProject>) {
        project.layouts[0]!.screens[0]!.elements.push({
          ...structuredClone(project.layouts[0]!.screens[0]!.elements[0]!),
          id: "t1",
        });
      },
      expected: [{
        message: 'duplicate element id within screen: "t1"',
        path: ["layouts", 0, "screens", 0, "elements", 1, "id"],
      }],
    },
    {
      category: "font identities",
      mutate(project: ReturnType<typeof validProject>) {
        setRawFonts(project, [
          { family: "Inter", source: "uploaded", path: "assets/fonts/inter-a.ttf", weight: 400 },
          { family: "Inter", source: "google", path: "assets/fonts/inter-b.ttf", weight: 400 },
        ]);
      },
      expected: [{
        message: 'duplicate font family and weight: "Inter" 400',
        path: ["fonts", 1],
      }],
    },
  ];

  it.each(cases)("preserves $category issue messages and paths", ({ mutate, expected }) => {
    const project = validProject();
    mutate(project);

    const result = Project.safeParse(project);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected project validation to fail");

    expect(result.error.issues.map(({ message, path }) => ({ message, path }))).toEqual(expected);
  });

  it("preserves issue order across project validators", () => {
    const project = validProject();
    project.layouts[0]!.screens.push({
      ...structuredClone(project.layouts[0]!.screens[0]!),
      id: "s2",
      variantOf: "s1",
      direction: "rtl",
    } as never);
    project.layouts[0]!.screens[0]!.elements.push({
      ...structuredClone(project.layouts[0]!.screens[0]!.elements[0]!),
      id: "t1",
    });
    setRawFonts(project, [
      { family: "Inter", source: "uploaded", path: "assets/fonts/inter-a.ttf", weight: 400 },
      { family: "Inter", source: "google", path: "assets/fonts/inter-b.ttf", weight: 400 },
    ]);

    const result = Project.safeParse(project);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected project validation to fail");

    expect(result.error.issues.map(({ message, path }) => ({ message, path }))).toEqual([
      {
        message: "variantOf requires storeTargetId",
        path: ["layouts", 0, "screens", 1],
      },
      {
        message: 'all screens in locale "en" must use direction "ltr"',
        path: ["layouts", 0, "screens", 1, "direction"],
      },
      {
        message: 'duplicate element id within screen: "t1"',
        path: ["layouts", 0, "screens", 0, "elements", 1, "id"],
      },
      {
        message: 'duplicate font family and weight: "Inter" 400',
        path: ["fonts", 1],
      },
    ]);
  });
});

describe("parseProject", () => {
  it("accepts a valid project and applies element defaults", () => {
    const project = parseProject(validProject());
    const el = project.layouts[0]!.screens[0]!.elements[0]!;
    expect(el.opacity).toBe(1);
    expect(el.visible).toBe(true);
    expect(el.rotation).toBe(0);
  });

  it("accepts connected mode", () => {
    const raw = validProject();
    raw.layouts[0]!.mode = "connected";
    expect(parseProject(raw).layouts[0]!.mode).toBe("connected");
  });

  it("accepts the complete schema v1 project without mutating the raw input", () => {
    const raw = validProject();
    raw.meta.schemaVersion = 1 as typeof SCHEMA_VERSION;
    const before = structuredClone(raw);

    const project = parseProject(raw);

    expect(project.meta.schemaVersion).toBe(1);
    expect(project.layouts[0]!.screens[0]!.direction).toBe("ltr");
    expect(raw).toEqual(before);
  });

  it.each(LEGACY_SCREEN_FAMILIES)(
    "keeps strict-v1 %s/%s project literals valid without migration",
    (platform, device) => {
      const raw = validProject();
      Object.assign(raw.layouts[0]!.screens[0]!, { platform, device });

      const parsed = parseProject(raw);

      expect(parsed.meta.schemaVersion).toBe(1);
      expect(parsed.layouts[0]!.screens[0]).toMatchObject({ platform, device });
    },
  );

  it("keeps every legacy device-frame literal valid in a strict-v1 project", () => {
    const raw = validProject();
    (raw.layouts[0]!.screens[0]! as unknown as { elements: unknown[] }).elements =
      LEGACY_DEVICE_FRAME_IDS.map((deviceType, index) => ({
        id: `legacy-frame-${index}`,
        type: "device-frame",
        x: 0,
        y: 0,
        width: 100,
        height: 200,
        deviceType,
      }));

    const parsed = parseProject(raw);

    expect(parsed.meta.schemaVersion).toBe(1);
    expect(parsed.layouts[0]!.screens[0]!.elements.map((element) =>
      element.type === "device-frame" ? element.deviceType : undefined))
      .toEqual(LEGACY_DEVICE_FRAME_IDS);
  });

  it.each([
    ["apple", "visionos"],
    ["android", "chromebook"],
    ["android", "tv"],
    ["android", "wear"],
    ["android", "automotive"],
    ["android", "xr"],
    ["windows", "xbox"],
    ["windows", "holographic"],
  ] as const)("accepts the widened %s/%s output family", (platform, device) => {
    const raw = validProject();
    Object.assign(raw.layouts[0]!.screens[0]!, { platform, device });

    expect(parseProject(raw).layouts[0]!.screens[0]).toMatchObject({ platform, device });
  });

  it("rejects square orientation as an unknown persisted Screen field", () => {
    const raw = validProject();
    Object.assign(raw.layouts[0]!.screens[0]!, { orientation: "square" });

    expect(() => parseProject(raw)).toThrow(ProjectValidationError);
  });

  it.each([2, 10])("rejects unsupported numeric schema version %s with a dedicated error", (version) => {
    const raw = validProject();
    raw.meta.schemaVersion = version as typeof SCHEMA_VERSION;

    expect(() => parseProject(raw)).toThrow(
      `Unsupported project schema version ${version}. This build accepts version 1 only.`,
    );
  });

  it.each([
    ["missing", undefined],
    ["non-numeric", "1"],
  ])("rejects a %s schema version through strict validation", (_case, version) => {
    const raw = validProject() as unknown as {
      meta: Record<string, unknown>;
    };
    const meta = raw.meta as Record<string, unknown>;
    if (version === undefined) delete meta.schemaVersion;
    else meta.schemaVersion = version;

    expect(() => parseProject(raw)).toThrow(ProjectValidationError);
  });

  it("does not migrate the historical incomplete v1 structure", () => {
    const raw = validProject() as unknown as {
      meta: Record<string, unknown>;
      layouts: Array<{ mode?: unknown }>;
    };
    delete raw.layouts[0]!.mode;
    (raw.meta as Record<string, unknown>).schemaVersion = 1;

    expect(() => parseProject(raw)).toThrow(ProjectValidationError);
  });

  it("accepts strict linear-gradient and image backgrounds with defaults", () => {
    const gradient = validProject() as unknown as {
      layouts: Array<{ screens: Array<Record<string, unknown>> }>;
    };
    const gradientScreen = gradient.layouts[0]!.screens[0]!;
    gradientScreen.background = { type: "linear-gradient", from: "#112233", to: "#AABBCC" };
    expect(parseProject(gradient).layouts[0]!.screens[0]!.background).toEqual({
      type: "linear-gradient", from: "#112233", to: "#AABBCC", angle: 0,
    });

    const image = validProject() as unknown as {
      layouts: Array<{ screens: Array<Record<string, unknown>> }>;
    };
    const imageScreen = image.layouts[0]!.screens[0]!;
    imageScreen.background = { type: "image", assetUrl: "assets/background.png" };
    expect(parseProject(image).layouts[0]!.screens[0]!.background).toEqual({
      type: "image", assetUrl: "assets/background.png", fit: "cover", color: "#000000",
    });
  });

  it("rejects invalid background values and unknown fields", () => {
    for (const background of [
      { type: "linear-gradient", from: "#000000", to: "#FFFFFF", angle: 361 },
      { type: "image", assetUrl: "", fit: "cover", color: "#000000" },
      { type: "solid", color: "#000000", opacity: 0.5 },
    ]) {
      const raw = validProject() as unknown as {
        layouts: Array<{ screens: Array<Record<string, unknown>> }>;
      };
      raw.layouts[0]!.screens[0]!.background = background;
      expect(() => parseProject(raw)).toThrow(ProjectValidationError);
    }
  });

  it("validates root and store-target variant relationships", () => {
    const raw = validProject();
    const variant = structuredClone(raw.layouts[0]!.screens[0]!);
    variant.id = "hero-65";
    variant.artboard = { width: 1284, height: 2778 };
    Object.assign(variant, {
      variantOf: raw.layouts[0]!.screens[0]!.id,
      storeTargetId: "6.5",
    });
    raw.layouts[0]!.screens.push(variant);
    expect(parseProject(raw).layouts[0]!.screens[1]).toMatchObject({
      variantOf: raw.layouts[0]!.screens[0]!.id,
      storeTargetId: "6.5",
    });

    const missingTarget = structuredClone(raw);
    delete (missingTarget.layouts[0]!.screens[1]! as unknown as Record<string, unknown>).storeTargetId;
    expect(() => parseProject(missingTarget)).toThrow(/variantOf requires storeTargetId/);

    const duplicate = structuredClone(raw);
    duplicate.layouts[0]!.screens.push({ ...structuredClone(duplicate.layouts[0]!.screens[1]!), id: "hero-65-copy" });
    expect(() => parseProject(duplicate)).toThrow(/duplicate store target variant/);
  });

  it("accepts standalone exact-size screens only for an independent screen set", () => {
    const independent = validProject();
    const standalone = structuredClone(independent.layouts[0]!.screens[0]!);
    standalone.id = "standalone-small";
    standalone.name = "Standalone small";
    Object.assign(standalone, { storeTargetId: "small" });
    independent.layouts[0]!.screens.push(standalone);

    expect(parseProject(independent).layouts[0]!.screens[1]).toMatchObject({
      id: "standalone-small",
      storeTargetId: "small",
    });
    expect(parseProject(independent).layouts[0]!.screens[1]!.variantOf).toBeUndefined();

    const synchronized = structuredClone(independent);
    Object.assign(synchronized.layouts[0]!, {
      screenSetPolicies: [{
        platform: "apple",
        device: "iphone",
        locale: "en",
        mode: "synchronized",
      }],
    });
    expect(() => parseProject(synchronized))
      .toThrow(/must match the root screen count and order/);
  });

  it("accepts a strict synchronized screen-set policy only when every target matches root order", () => {
    const raw = validProject();
    const secondRoot = structuredClone(raw.layouts[0]!.screens[0]!);
    secondRoot.id = "s2";
    secondRoot.name = "Screen 2";
    const firstVariant = structuredClone(raw.layouts[0]!.screens[0]!);
    firstVariant.id = "s1-small";
    Object.assign(firstVariant, { variantOf: "s1", storeTargetId: "small" });
    const secondVariant = structuredClone(secondRoot);
    secondVariant.id = "s2-small";
    Object.assign(secondVariant, { variantOf: "s2", storeTargetId: "small" });
    raw.layouts[0]!.screens.push(secondRoot, firstVariant, secondVariant);
    Object.assign(raw.layouts[0]!, {
      screenSetPolicies: [{
        platform: "apple",
        device: "iphone",
        locale: "en",
        mode: "synchronized",
      }],
    });

    expect(parseProject(raw).layouts[0]!.screenSetPolicies?.[0]?.mode)
      .toBe("synchronized");

    const missingSlot = structuredClone(raw);
    missingSlot.layouts[0]!.screens.pop();
    expect(() => parseProject(missingSlot)).toThrow(/must match the root screen count and order/);

    const wrongOrder = structuredClone(raw);
    const variants = wrongOrder.layouts[0]!.screens.splice(2, 2);
    wrongOrder.layouts[0]!.screens.push(variants[1]!, variants[0]!);
    expect(() => parseProject(wrongOrder)).toThrow(/must match the root screen count and order/);
  });

  it("rejects duplicate or orphaned screen-set policies", () => {
    const duplicate = validProject();
    Object.assign(duplicate.layouts[0]!, {
      screenSetPolicies: [
        { platform: "apple", device: "iphone", locale: "en", mode: "independent" },
        { platform: "apple", device: "iphone", locale: "en", mode: "synchronized" },
      ],
    });
    expect(() => parseProject(duplicate)).toThrow(/duplicate screen set policy/);

    const orphaned = validProject();
    Object.assign(orphaned.layouts[0]!, {
      screenSetPolicies: [{
        platform: "web",
        device: "desktop",
        locale: "en",
        mode: "independent",
      }],
    });
    expect(() => parseProject(orphaned)).toThrow(/has no matching output family/);
  });

  it("rejects duplicate screen ids before resolving variant references", () => {
    const raw = validProject();
    raw.layouts[0]!.screens.push(structuredClone(raw.layouts[0]!.screens[0]!));
    expect(() => parseProject(raw)).toThrow(/duplicate screen id/);
  });

  it("rejects unknown keys (strict contract)", () => {
    const bad = validProject();
    (bad as Record<string, unknown>).unexpected = true;
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("rejects a non-hex color", () => {
    const bad = validProject();
    bad.layouts[0]!.screens[0]!.background.color = "black";
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("rejects an unknown element type via the discriminated union", () => {
    const bad = validProject();
    (bad.layouts[0]!.screens[0]!.elements[0] as Record<string, unknown>).type = "screenshot";
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });

  it("requires at least one screen", () => {
    const bad = validProject();
    bad.layouts[0]!.screens = [];
    expect(() => parseProject(bad)).toThrow(ProjectValidationError);
  });
});

describe("FontWeight", () => {
  it("publishes one bounded default contract for every consumer", () => {
    expect(FONT_WEIGHT_MIN).toBe(100);
    expect(FONT_WEIGHT_MAX).toBe(900);
    expect(FONT_WEIGHT_STEP).toBe(100);
    expect(DEFAULT_FONT_WEIGHT).toBe(400);
    expect(FontWeight.parse(undefined)).toBe(DEFAULT_FONT_WEIGHT);
    expect(FontWeight.parse(FONT_WEIGHT_MIN)).toBe(FONT_WEIGHT_MIN);
    expect(FontWeight.parse(FONT_WEIGHT_MAX)).toBe(FONT_WEIGHT_MAX);
    expect(FontWeight.safeParse(FONT_WEIGHT_MIN - 1).success).toBe(false);
    expect(FontWeight.safeParse(FONT_WEIGHT_MAX + 1).success).toBe(false);
    expect(FontWeight.safeParse(450.5).success).toBe(false);
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
    for (const deviceType of ["iphone", "android-phone", "tablet", "desktop", "laptop", "browser", "tv", "watch"] as const) {
      expect(Element.parse({ ...base, deviceType })).toMatchObject({ deviceType });
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

  it.each(["tablet-7", "tablet-10"] as const)("accepts android/%s", (device) => {
    expect(Screen.safeParse({ ...baseScreen, platform: "android", device }).success).toBe(true);
  });

  it("rejects promotion as an Android device", () => {
    const raw = validProject();
    raw.layouts[0]!.screens[0] = { ...raw.layouts[0]!.screens[0]!, platform: "android", device: "promotion" } as never;
    expect(() => parseProject(raw)).toThrow(/device/);
  });

  it.each(["desktop", "laptop", "tablet", "mobile"] as const)("accepts web/%s", (device) => {
    expect(Screen.safeParse({ ...baseScreen, platform: "web", device }).success).toBe(true);
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
    expect(parseProject(validProject()).layouts[0]!.screens[0]!.direction).toBe("ltr");
  });

  it("accepts an explicit rtl direction", () => {
    const project = validProject();
    (project.layouts[0]!.screens[0] as Record<string, unknown>).direction = "rtl";

    expect(parseProject(project).layouts[0]!.screens[0]!.direction).toBe("rtl");
  });

  it("rejects an unknown direction", () => {
    const project = validProject();
    (project.layouts[0]!.screens[0] as Record<string, unknown>).direction = "auto";

    expect(() => parseProject(project)).toThrow(ProjectValidationError);
  });

  it("requires every screen in one locale set to share a direction", () => {
    const project = validProject();
    (project.layouts[0]!.screens[0] as Record<string, unknown>).direction = "ltr";
    project.layouts[0]!.screens.push({
      ...structuredClone(project.layouts[0]!.screens[0]!),
      id: "s2",
      name: "Screen 2",
    });
    (project.layouts[0]!.screens[1] as Record<string, unknown>).direction = "rtl";

    expect(() => parseProject(project)).toThrow(ProjectValidationError);
  });
});
