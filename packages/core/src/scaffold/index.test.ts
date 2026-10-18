// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBundleEntries,
  findStoreTarget,
  leadStoreSizeId,
  parseStoreSpecs,
  validateBundleArtboards,
  type StoreSpecs,
} from "@screenshot-studio/core/export";
import { parseProject, screenSetModeFor } from "@screenshot-studio/core/model";
import { applyDesignPack, listBuiltInDesignPacks } from "@screenshot-studio/core/themes";
import {
  PROJECT_NAME_MAX_LENGTH,
  ProjectScaffoldInput,
  createProjectScaffold,
  listStarterProjectTemplates,
  recommendedDeviceForPlatform,
  projectScaffoldFiles,
  validateProjectScaffold,
} from "./index.js";

const fullSpecs = parseStoreSpecs(JSON.parse(readFileSync(join(process.cwd(), "store-specs.json"), "utf8")));
const specs: StoreSpecs = structuredClone(fullSpecs);
Object.assign(
  specs.platforms.windows.families.desktop.targets.find(({ id }) => id === "4k")!,
  { width: 1920, height: 1080 },
);
const reorderedLeadSpecs = parseStoreSpecs({
  ...fullSpecs,
  platforms: {
    ...fullSpecs.platforms,
    apple: {
      ...fullSpecs.platforms.apple,
      families: {
        ...fullSpecs.platforms.apple.families,
        iphone: {
          ...fullSpecs.platforms.apple.families.iphone,
          targets: [
            { id: "6.1", label: "6.1-inch display", width: 1179, height: 2556, orientation: "portrait" },
            { id: "6.3", label: "6.3-inch display", width: 1206, height: 2622, orientation: "portrait" },
          ],
        },
      },
    },
  },
});

describe("ProjectScaffoldInput", () => {
  it("exports and enforces one project name length limit", () => {
    expect(PROJECT_NAME_MAX_LENGTH).toBe(120);
    expect(() => ProjectScaffoldInput.parse({
      name: "a".repeat(PROJECT_NAME_MAX_LENGTH + 1),
      platform: "apple",
      device: "iphone",
      layoutMode: "isolated",
      templateId: null,
    })).toThrow();
  });

  it("strictly normalizes creation input without accepting destination paths", () => {
    expect(ProjectScaffoldInput.parse({
      name: "  Launch Story  ", platform: "apple", device: "iphone", layoutMode: "connected", templateId: null,
    })).toEqual({
      name: "Launch Story", platform: "apple", device: "iphone", layoutMode: "connected", templateId: null,
    });
    expect(() => ProjectScaffoldInput.parse({
      name: "Unsafe", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null,
      path: "/srv/projects/unsafe",
    })).toThrow();
  });

  it("requires a platform-compatible device family at the API boundary", () => {
    expect(ProjectScaffoldInput.parse({
      name: "Tablet", platform: "apple", device: "ipad", layoutMode: "isolated", templateId: null,
    })).toMatchObject({ platform: "apple", device: "ipad" });
    expect(() => ProjectScaffoldInput.parse({
      name: "Invalid", platform: "apple", device: "wear", layoutMode: "isolated", templateId: null,
    })).toThrow();
    expect(() => ProjectScaffoldInput.parse({
      name: "Missing", platform: "apple", layoutMode: "isolated", templateId: null,
    })).toThrow();
    expect(recommendedDeviceForPlatform("android")).toBe("phone");
  });

  it("uses the recommended family declared by the supplied catalog", () => {
    const customSpecs = structuredClone(fullSpecs);
    Object.assign(customSpecs.platforms.apple.families.iphone, { recommended: false });
    Object.assign(customSpecs.platforms.apple.families.ipad, { recommended: true });

    expect(recommendedDeviceForPlatform("apple", customSpecs)).toBe("ipad");
  });
});

describe("starter project templates", () => {
  it("exposes a small strict library with preview, intended use, and platform metadata", () => {
    const templates = listStarterProjectTemplates();

    expect(templates.map(({ id }) => id)).toEqual([
      "feature-focus", "product-launch", "iphone-starter", "ipad-portrait-starter",
      "android-phone-starter", "android-tablet-portrait-starter", "play-feature-graphic",
      "web-desktop-starter", "web-mobile-starter",
    ]);
    for (const template of templates) {
      expect(template).toMatchObject({
        id: expect.stringMatching(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        name: expect.any(String),
        intendedUse: expect.any(String),
        supportedPlatforms: expect.any(Array),
        preview: {
          backgroundFrom: expect.stringMatching(/^#/),
          backgroundTo: expect.stringMatching(/^#/),
          accent: expect.stringMatching(/^#/),
        },
      });
      expect(Object.keys(template).sort()).toEqual(template.device
        ? ["description", "device", "id", "intendedUse", "name", "preview", "supportedPlatforms"]
        : ["description", "id", "intendedUse", "name", "preview", "supportedPlatforms"]);
    }
  });
});

describe("createProjectScaffold", () => {
  it("rejects families disabled for creation by the runtime catalog", () => {
    const customSpecs = structuredClone(fullSpecs);
    Object.assign(customSpecs.platforms.apple.families.iphone, { creatable: false, recommended: false });
    Object.assign(customSpecs.platforms.apple.families.ipad, { recommended: true });

    expect(() => createProjectScaffold({
      name: "Disabled phone", platform: "apple", device: "iphone",
      layoutMode: "isolated", templateId: null,
    }, customSpecs)).toThrow(/creation is not enabled for apple\/iphone/i);
  });

  it.each([
    ["apple", "ipad"],
    ["android", "wear"],
    ["windows", "xbox"],
    ["web", "mobile"],
  ] as const)("uses the selected %s/%s family lead target", (platform, device) => {
    const scaffold = createProjectScaffold(ProjectScaffoldInput.parse({
      name: `${platform} ${device}`, platform, device, layoutMode: "isolated", templateId: null,
    }), fullSpecs);
    const expected = findStoreTarget(fullSpecs, platform, device, leadStoreSizeId(platform, device));

    expect(scaffold.project.layouts[0]!.screens[0]).toMatchObject({
      platform, device, artboard: { width: expected.width, height: expected.height },
    });
  });

  it("uses the catalog-declared lead target regardless of store-spec target order", () => {
    const scaffold = createProjectScaffold({
      name: "Ordered by catalog", platform: "apple", device: "iphone",
      layoutMode: "isolated", templateId: null,
    }, reorderedLeadSpecs);

    expect(scaffold.project.layouts[0]!.screens[0]!.artboard).toEqual({ width: 1206, height: 2622 });
  });

  it("creates a valid empty project using the selected platform lead size and layout mode", () => {
    const scaffold = createProjectScaffold({
      name: "Desktop Story", platform: "windows", device: "desktop", layoutMode: "connected", templateId: null,
    }, specs);

    expect(parseProject(scaffold.project)).toEqual(scaffold.project);
    expect(scaffold.project).toMatchObject({
      meta: { name: "Desktop Story", schemaVersion: 1 },
      preferredExportLayoutId: "default",
      layouts: [{
        id: "default", name: "Default", mode: "connected",
        screenSetPolicies: [{
          platform: "windows", device: "desktop", locale: "en", mode: "synchronized",
        }],
        screens: [{
          id: "hero", platform: "windows", device: "desktop",
          artboard: { width: 1920, height: 1080 },
          background: { type: "solid", color: "#FFFFFF" }, elements: [],
        }],
      }],
    });
    expect(scaffold.resources).toEqual([]);
  });

  it("instantiates every starter as an ordinary strict project for each supported platform", () => {
    for (const template of listStarterProjectTemplates()) {
      for (const platform of template.supportedPlatforms) {
        const scaffold = createProjectScaffold(ProjectScaffoldInput.parse({
          name: `${template.name} ${platform}`,
          platform,
          device: template.device ?? recommendedDeviceForPlatform(platform),
          layoutMode: "isolated",
          templateId: template.id,
        }), fullSpecs);

        expect(parseProject(scaffold.project)).toEqual(scaffold.project);
        expect(scaffold.project.layouts[0]!.screens.length).toBeGreaterThanOrEqual(1);
        expect(new Set(scaffold.project.layouts[0]!.screens.map((screen) => screen.platform))).toEqual(
          new Set([platform]),
        );
        const root = scaffold.project.layouts[0]!.screens.find((screen) => screen.storeTargetId === undefined);
        if (root) {
          expect(screenSetModeFor(scaffold.project.layouts[0]!, root)).toBe("synchronized");
        }
        expect(scaffold.project.layouts[0]!.screens.some((screen) => screen.elements.length > 0)).toBe(true);
        expect(scaffold.resources).toEqual([]);
      }
    }
  });

  it.each([
    ["iphone-starter", "apple"],
    ["android-phone-starter", "android"],
    ["web-desktop-starter", "web"],
  ] as const)("bakes the global design pack into a newly scaffolded %s", (templateId, platform) => {
    const scaffold = createProjectScaffold(ProjectScaffoldInput.parse({
      name: `Packed ${templateId}`,
      platform,
      device: recommendedDeviceForPlatform(platform),
      layoutMode: "isolated",
      templateId,
    }), fullSpecs);
    const screen = scaffold.project.layouts[0]!.screens[0]!;
    const beforeHeading = screen.elements.find((element) => (
      "role" in element && element.role === "heading"
    ));
    const beforeAccent = screen.elements.find((element) => (
      "role" in element && element.role === "accent"
    ));
    expect(beforeHeading).toMatchObject({ type: "text", color: "#FFFFFF" });
    expect(beforeAccent).toMatchObject({ type: "shape", fill: "#38BDF8" });

    const pack = listBuiltInDesignPacks()[0]!;
    const packed = applyDesignPack(scaffold.project, "default", pack);
    const packedScreen = packed.layouts[0]!.screens[0]!;
    expect(packedScreen.elements.find((element) => (
      "role" in element && element.role === "heading"
    ))).toMatchObject({
      type: "text",
      color: "#0F172A",
      fontFamily: "Screenshot Studio Sans",
      weight: 400,
      size: 64,
    });
    expect(packedScreen.elements.find((element) => (
      "role" in element && element.role === "accent"
    ))).toMatchObject({
      type: "shape",
      fill: "#2563EB",
    });
    expect(parseProject(packed)).toEqual(packed);
    expect(JSON.stringify(packed)).not.toContain(pack.id);
  });

  it("creates Play Feature Graphic as the only default Android output", () => {
    const scaffold = createProjectScaffold({
      name: "Feature graphic", platform: "android", device: "phone", layoutMode: "isolated",
      templateId: "play-feature-graphic",
    }, fullSpecs);
    const screens = scaffold.project.layouts[0]!.screens;
    expect(screens).toHaveLength(1);
    expect(screens[0]).toMatchObject({
      platform: "android", device: "phone", storeTargetId: "play-feature-graphic",
      artboard: { width: 1024, height: 500 },
    });
    expect(screens[0]!.variantOf).toBeUndefined();
    const entries = buildBundleEntries(scaffold.project, "default", fullSpecs);
    expect(entries.map(({ target }) => target.id)).toEqual(["play-feature-graphic"]);
    expect(() => validateBundleArtboards(entries)).not.toThrow();
  });

  it("rejects unknown templates and missing lead store dimensions", () => {
    expect(() => createProjectScaffold({
      name: "Unknown", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: "not-registered",
    }, specs)).toThrow(/unknown project template/i);
    expect(() => createProjectScaffold({
      name: "Missing specs", platform: "windows", device: "desktop", layoutMode: "isolated", templateId: null,
    }, (() => {
      const missing = structuredClone(specs);
      missing.platforms.windows.families.desktop.targets = [];
      return missing;
    })())).toThrow(/store size|Unknown target/i);
    expect(() => createProjectScaffold({
      name: "Unsupported", platform: "windows", device: "desktop", layoutMode: "isolated", templateId: "product-launch",
    }, specs)).toThrow(/does not support windows/i);
  });
});

describe("validateProjectScaffold", () => {
  it("requires every referenced project resource before returning publishable files", () => {
    const scaffold = createProjectScaffold({
      name: "Dependencies", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null,
    }, specs);
    scaffold.project.layouts[0]!.screens[0]!.elements.push({
      id: "shot", type: "screenshot", x: 0, y: 0, width: 100, height: 100,
      rotation: 0, opacity: 1, locked: false, visible: true,
      assetUrl: "screenshots/hero.png", fit: "cover", cornerRadius: 0,
    });

    expect(() => validateProjectScaffold(scaffold)).toThrow(/missing.*screenshots\/hero\.png/i);
    expect(() => validateProjectScaffold({
      ...scaffold,
      resources: [{ path: "screenshots/Hero.png", bytes: new Uint8Array([1, 2, 3]) }],
    })).toThrow(/missing.*screenshots\/hero\.png/i);
    const complete = validateProjectScaffold({
      ...scaffold,
      resources: [{ path: "screenshots/hero.png", bytes: new Uint8Array([1, 2, 3]) }],
    });
    expect(complete.resources).toHaveLength(1);
    expect(projectScaffoldFiles(complete).map(({ path }) => path)).toEqual([
      "app-store-screenshots.json", "screenshots/hero.png",
    ]);
  });

  it("rejects reserved and portable-colliding resource paths", () => {
    const scaffold = createProjectScaffold({
      name: "Unsafe resources", platform: "apple", device: "iphone", layoutMode: "isolated", templateId: null,
    }, specs);

    expect(() => validateProjectScaffold({
      ...scaffold,
      resources: [{ path: "app-store-screenshots.json", bytes: new Uint8Array() }],
    })).toThrow(/reserved/i);
    expect(() => validateProjectScaffold({
      ...scaffold,
      resources: [{ path: "APP-STORE-SCREENSHOTS.JSON", bytes: new Uint8Array() }],
    })).toThrow(/reserved/i);
    expect(() => validateProjectScaffold({
      ...scaffold,
      resources: [
        { path: "assets/Icon.png", bytes: new Uint8Array() },
        { path: "assets/icon.png", bytes: new Uint8Array() },
      ],
    })).toThrow(/duplicate/i);
  });
});
