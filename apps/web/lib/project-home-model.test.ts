// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import type { Project } from "@screenshot-studio/core/model";
import type { StoreSpecs } from "@screenshot-studio/core/export";
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

const specs: StoreSpecs = {
  apple: { iphone: [{ id: "6.9", label: "6.9-inch iPhone (lead)", width: 1320, height: 2868, orientation: "portrait" }] },
  android: { phone: [
    { id: "phone-portrait", label: "Android phone portrait", width: 1080, height: 1920, orientation: "portrait" },
    { id: "phone-landscape", label: "Android phone landscape", width: 1920, height: 1080, orientation: "landscape" },
  ] },
};

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
    },
    ...overrides,
  };
}

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
      source: { kind: "managed-project", label: "Managed browser project" },
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
      expect.objectContaining({ key: "apple/iphone", label: "App Store · iPhone", screenCount: 2, storeTargets: ["6.9-inch iPhone (lead)"] }),
      expect.objectContaining({ key: "android/phone", label: "Google Play · Android phone", screenCount: 2, storeTargets: ["Android phone portrait", "Android phone landscape"] }),
    ]);
    expect(summary.representativeScreens).toEqual([
      { layoutId: "isolated", screenId: "iphone-en", name: "Welcome", layoutName: "Product cards" },
      { layoutId: "connected", screenId: "android-root", name: "Benefits", layoutName: "Connected campaign" },
    ]);
    expect(summary.readiness.map((item) => item.kind)).toEqual([
      "empty-screens",
      "missing-assets",
      "font-warning",
      "save-error",
    ]);
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
        },
      }),
      specs,
    });

    expect(writable.actions.find((action) => action.id === "store-image-export")).toMatchObject({ enabled: true, label: "Export store images" });
    expect(writable.actions.find((action) => action.id === "project-archive-export")).toMatchObject({ enabled: true, label: "Export project archive" });
    expect(readOnly.actions.find((action) => action.id === "continue-editing")?.enabled).toBe(false);
    expect(readOnly.actions.find((action) => action.id === "manage-layouts")?.enabled).toBe(false);
    expect(readOnly.actions.find((action) => action.id === "project-archive-export")?.enabled).toBe(false);
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
});
