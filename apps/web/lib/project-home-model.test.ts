// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import { DEFAULT_STORE_SPECS, type StoreSpecs } from "@screenshot-studio/core/export";
import type { ActiveProjectSelection } from "./project-session.js";
import { buildProjectHomeSummary } from "./project-home-model.js";

const project: Project = {
  meta: { name: "Launch Story", schemaVersion: 1 },
  fonts: [],
  preferredExportLayoutId: "connected",
  layouts: [
    {
      id: "isolated",
      name: "Product cards",
      mode: "isolated",
      screens: [
        {
          id: "iphone-en",
          name: "Welcome",
          platform: "apple",
          device: "iphone",
          locale: "en-US",
          direction: "ltr",
          artboard: { width: 1320, height: 2868 },
          background: { type: "solid", color: "#101827" },
          elements: [],
        },
        {
          id: "iphone-fr",
          name: "Bienvenue",
          platform: "apple",
          device: "iphone",
          locale: "fr-FR",
          direction: "ltr",
          artboard: { width: 1320, height: 2868 },
          background: { type: "image", assetUrl: "assets/missing.png", color: "#101827", fit: "cover" },
          elements: [],
        },
      ],
    },
    {
      id: "connected",
      name: "Connected campaign",
      mode: "connected",
      screens: [
        {
          id: "android-root",
          name: "Benefits",
          platform: "android",
          device: "phone",
          locale: "en-US",
          direction: "ltr",
          artboard: { width: 1080, height: 1920 },
          background: { type: "solid", color: "#101827" },
          elements: [{
            id: "headline",
            type: "text",
            x: 80,
            y: 80,
            width: 800,
            height: 160,
            rotation: 0,
            opacity: 1,
            locked: false,
            visible: true,
            content: "Benefits",
            fontFamily: "Inter",
            size: 72,
            weight: 700,
            lineHeight: 1.2,
            letterSpacing: 0,
            align: "left",
            color: "#FFFFFF",
          }],
        },
        {
          id: "android-landscape",
          name: "Benefits landscape",
          platform: "android",
          device: "phone",
          locale: "en-US",
          direction: "ltr",
          variantOf: "android-root",
          storeTargetId: "phone-landscape",
          artboard: { width: 1920, height: 1080 },
          background: { type: "solid", color: "#101827" },
          elements: [],
        },
      ],
    },
  ],
};

const specs: StoreSpecs = structuredClone(DEFAULT_STORE_SPECS);
specs.platforms.apple.families.iphone.targets = [
  { id: "6.9", label: "6.9-inch iPhone (lead)", width: 1320, height: 2868, orientation: "portrait" },
];
specs.platforms.android.families.phone.targets = [
  { id: "phone-portrait", label: "Android phone portrait", width: 1080, height: 1920, orientation: "portrait" },
  { id: "phone-landscape", label: "Android phone landscape", width: 1920, height: 1080, orientation: "landscape" },
];
specs.platforms.web.families.desktop.targets = [
  { id: "desktop-1920", label: "Web desktop 1920×1080 (lead)", width: 1920, height: 1080, orientation: "landscape", kind: "responsive" },
];

function selection(overrides: Partial<ActiveProjectSelection> = {}): ActiveProjectSelection {
  return {
    sessionId: "session",
    projectId: "project",
    name: "Launch Story",
    sourceKind: "managed-project",
    capabilities: {
      writeInPlace: true,
      revealLocation: false,
      watchExternalChanges: false,
      nativePicker: false,
      projectLocalResources: true,
      exportProjectArchive: true,
        deleteProjectPermanently: true,
    },
    ...overrides,
  };
}

const managedEntryId = "project_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("buildProjectHomeSummary", () => {
  it("derives stable project, layout, locale, platform, output, target, and preview summaries", () => {
    const summary = buildProjectHomeSummary({
      project,
      selection: selection(),
      specs,
      missingAssets: ["assets/missing.png"],
      fontWarnings: ["Inter 700 could not be registered"],
      saveError: "Disk is read-only",
    });

    expect(summary).toMatchObject({
      name: "Launch Story",
      source: { kind: "managed-project", label: "Managed project" },
      screenCount: 4,
      emptyScreenCount: 3,
      platforms: ["App Store", "Google Play"],
      locales: ["en-US", "fr-FR"],
      preferredLayout: { id: "connected", name: "Connected campaign" },
    });
    expect(summary.layouts).toEqual([
      expect.objectContaining({ id: "isolated", name: "Product cards", mode: "isolated", screenCount: 2, emptyScreenCount: 2, preferred: false }),
      expect.objectContaining({ id: "connected", name: "Connected campaign", mode: "connected", screenCount: 2, emptyScreenCount: 1, preferred: true }),
    ]);
    expect(summary.outputFamilies).toEqual([
      expect.objectContaining({ key: "apple/iphone", label: "App Store · iPhone", screenCount: 2, storeTargets: ["6.9-inch iPhone"] }),
      expect.objectContaining({ key: "android/phone", label: "Google Play · Android phone", screenCount: 2, storeTargets: ["Android phone portrait", "Android phone landscape"] }),
    ]);
    expect(summary.representativeScreens).toEqual([
      { layoutId: "isolated", screenId: "iphone-en", name: "Welcome", layoutName: "Product cards", outputLabel: "App Store · iPhone", width: 1320, height: 2868 },
      { layoutId: "connected", screenId: "android-root", name: "Benefits", layoutName: "Connected campaign", outputLabel: "Google Play · Android phone", width: 1080, height: 1920 },
    ]);
    expect(summary.readiness.map((item) => item.kind)).toEqual([
      "empty-screens",
      "missing-assets",
      "font-warning",
      "save-error",
    ]);
    expect(summary.readiness.find((item) => item.kind === "missing-assets")?.detail)
      .toContain("Restore or reimport");
    expect(summary.readiness.find((item) => item.kind === "save-error")?.detail)
      .toContain("Return to Workspace and retry");
  });

  it("keeps Web and iPhone represented when they share one layout without filling the gallery with empty duplicates", () => {
    const mixedProject = structuredClone(project);
    mixedProject.layouts[0]!.screens.push({
      id: "web-home",
      name: "Web home",
      platform: "web",
      device: "desktop",
      locale: "en-US",
      direction: "ltr",
      artboard: { width: 1920, height: 1080 },
      background: { type: "solid", color: "#101827" },
      elements: [],
    });

    const summary = buildProjectHomeSummary({ project: mixedProject, selection: selection(), specs });

    expect(summary.representativeScreens.map(({ layoutId, screenId, outputLabel }) => ({
      layoutId,
      screenId,
      outputLabel,
    }))).toEqual([
      { layoutId: "isolated", screenId: "iphone-en", outputLabel: "App Store · iPhone" },
      { layoutId: "isolated", screenId: "web-home", outputLabel: "Web · Desktop" },
      { layoutId: "connected", screenId: "android-root", outputLabel: "Google Play · Android phone" },
    ]);
  });

  it("summarizes every destination and representative family with catalog labels", () => {
    const catalogProject = structuredClone(project);
    const base = catalogProject.layouts[0]!.screens[0]!;
    catalogProject.layouts[0]!.screens.push(
      { ...base, id: "ipad", platform: "apple", device: "ipad" },
      { ...base, id: "android-tablet", platform: "android", device: "tablet-7" },
      { ...base, id: "wear", platform: "android", device: "wear" },
      { ...base, id: "xbox", platform: "windows", device: "xbox" },
      { ...base, id: "web-desktop", platform: "web", device: "desktop" },
      { ...base, id: "web-laptop", platform: "web", device: "laptop" },
    );

    const summary = buildProjectHomeSummary({
      project: catalogProject,
      selection: selection(),
      specs,
    });

    expect(summary.platforms).toEqual(["App Store", "Google Play", "Microsoft Store", "Web"]);
    expect(summary.outputFamilies.map(({ label }) => label)).toEqual([
      "App Store · iPhone",
      "App Store · iPad",
      "Google Play · Android tablet",
      "Google Play · Wear OS",
      "Microsoft Store · Xbox",
      "Web · Desktop",
      "Web · Laptop",
      "Google Play · Android phone",
    ]);
    expect(summary.outputFamilies.map(({ label }) => label).join(" ")).not.toContain("tablet-7");
  });

  it("shows an exact local path only when the descriptor safely exposes it", () => {
    const local = buildProjectHomeSummary({
      project,
      selection: selection({
        sourceKind: "local-file",
        displayLocation: "/safe/project/app-store-screenshots.json",
        capabilities: { ...selection().capabilities, revealLocation: true, exportProjectArchive: false },
      }),
      specs,
    });
    const malformedManaged = buildProjectHomeSummary({
      project,
      selection: selection({ displayLocation: "/private/server/managed/project.json" }),
      specs,
    });

    expect(local.source).toEqual({
      kind: "local-file",
      label: "Local project file",
      location: "/safe/project/app-store-screenshots.json",
    });
    expect(malformedManaged.source).not.toHaveProperty("location");
  });

  it("resolves a promotion variant from the platform output catalog", () => {
    const promotionProject = structuredClone(project);
    const variant = promotionProject.layouts[1]!.screens[1]!;
    variant.name = "Feature graphic";
    variant.storeTargetId = "play-feature-graphic";
    variant.artboard = { width: 1024, height: 500 };
    const promotionSpecs = structuredClone(specs);
    promotionSpecs.platforms.android.families.phone.targets = [
      specs.platforms.android.families.phone.targets[0]!,
      {
          id: "play-feature-graphic",
          label: "Google Play Feature Graphic",
          width: 1024,
          height: 500,
          orientation: "landscape",
          kind: "promotion",
        },
      ];

    const summary = buildProjectHomeSummary({
      project: promotionProject,
      selection: selection(),
      specs: promotionSpecs,
    });

    expect(summary.outputFamilies.find(({ key }) => key === "android/phone")?.storeTargets)
      .toEqual(["Android phone portrait", "Google Play Feature Graphic"]);
  });

  it("gates actions by descriptor capabilities and keeps archive/store export distinct", () => {
    const writable = buildProjectHomeSummary({ project, selection: selection(), specs });
    const readOnly = buildProjectHomeSummary({
      project,
      selection: selection({
        capabilities: {
          ...selection().capabilities,
          writeInPlace: false,
          projectLocalResources: false,
          exportProjectArchive: false,
        deleteProjectPermanently: false,
        },
      }),
      specs,
    });

    expect(writable.actions.find((action) => action.id === "store-image-export")).toMatchObject({ enabled: true, label: "Export store images" });
    expect(writable.actions.find((action) => action.id === "project-archive-export")).toMatchObject({ enabled: true, label: "Export project archive" });
    expect(writable.actions.find((action) => action.id === "permanently-delete-project")).toMatchObject({
      enabled: true,
      label: "Permanently delete project",
    });
    expect(readOnly.actions.find((action) => action.id === "continue-editing")?.enabled).toBe(false);
    expect(readOnly.actions.find((action) => action.id === "manage-layouts")?.enabled).toBe(false);
    expect(readOnly.actions.find((action) => action.id === "project-archive-export")?.enabled).toBe(false);
    expect(readOnly.actions.find((action) => action.id === "permanently-delete-project")?.enabled).toBe(false);
    expect(readOnly.actions.find((action) => action.id === "import-project")?.enabled).toBe(true);
    expect(writable.actions.find((action) => action.id === "capture-import")).toMatchObject({
      enabled: true,
      label: "Capture import",
    });
    expect(readOnly.actions.find((action) => action.id === "capture-import")).toMatchObject({
      enabled: true,
      description: expect.stringContaining("new managed project"),
    });
  });

  it("addresses Workspace actions to the Project Library entry when it is known", () => {
    const summary = buildProjectHomeSummary({
      project,
      selection: selection({ projectId: managedEntryId }),
      specs,
      entryId: managedEntryId,
    });

    expect(summary.actions.find((action) => action.id === "continue-editing")?.href)
      .toBe(`/editor/${managedEntryId}`);
    expect(summary.actions.find((action) => action.id === "manage-locales")?.href)
      .toBe(`/editor/${managedEntryId}?intent=locales`);
  });
});
