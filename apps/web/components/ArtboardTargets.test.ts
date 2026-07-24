// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DesignLayout, Screen } from "@screenshot-studio/core/model";
import type { StoreSpecs } from "@screenshot-studio/core/export";
import { ArtboardTargets } from "./ArtboardTargets.js";
import { editorUi } from "./editor-ui/styles.js";

// Vitest compiles the Next.js-preserved JSX with the classic runtime for this Node-only render.
Object.assign(globalThis, { React });

const screen = {
  id: "web-desktop",
  name: "Hero",
  platform: "web",
  device: "desktop",
  locale: "en",
  direction: "ltr",
  artboard: { width: 1920, height: 1080 },
  background: { type: "solid", color: "#ffffff" },
  elements: [],
} as Screen;
const layout = {
  id: "primary",
  name: "Primary",
  mode: "isolated",
  screens: [screen],
} as DesignLayout;
const specs = {
  web: {
    desktop: [
      {
        id: "desktop-1920",
        label: "Web desktop 1920×1080 (lead)",
        width: 1920,
        height: 1080,
        orientation: "landscape",
        kind: "responsive",
      },
      {
        id: "desktop-1440",
        label: "Web desktop 1440×900",
        width: 1440,
        height: 900,
        orientation: "landscape",
        kind: "responsive",
      },
    ],
    mobile: [{
      id: "mobile-portrait",
      label: "Web mobile portrait (lead)",
      width: 390,
      height: 844,
      orientation: "portrait",
      kind: "responsive",
    }],
  },
} as StoreSpecs;

describe("ArtboardTargets", () => {
  it("presents output destination, family, structure, and sizes as distinct hierarchy levels", () => {
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout,
      screen,
      specs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain(">Destinations<");
    expect(markup).toContain("Web");
    expect(markup).toContain("Desktop");
    expect(markup).toContain("Screen structure");
    expect(markup).toContain("Separate");
    expect(markup).toContain("Sync structure");
    expect(markup).toContain("Output sizes");
    expect(markup).not.toContain("Output targets");
    expect(markup).not.toContain("Screenshot sizes");
    expect(markup).not.toContain("Viewport sizes");
    expect(markup).not.toContain("Promotional assets");
    expect(markup).not.toContain("Store listing sizes");
    expect(markup).not.toContain(">Web · Desktop<");
    expect(markup).not.toContain("screenshots");
    expect(markup).not.toContain("Create from the current output");
    expect(markup).not.toContain("created");
  });

  it("does not offer legacy Web laptop as a new output but keeps an existing family visible", () => {
    const laptop = {
      ...screen,
      id: "web-laptop",
      device: "laptop",
      artboard: { width: 1440, height: 900 },
    } as Screen;
    const legacySpecs = {
      web: {
        desktop: specs.web!.desktop,
        laptop: [{
          id: "laptop-1440",
          label: "Web laptop 1440×900 (lead)",
          width: 1440,
          height: 900,
          orientation: "landscape",
          kind: "responsive",
        }],
      },
    } as StoreSpecs;
    const withoutLegacy = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout,
      screen,
      specs: legacySpecs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));
    const withLegacy = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout: { ...layout, screens: [screen, laptop] },
      screen: laptop,
      specs: legacySpecs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(withoutLegacy).toMatch(/aria-label="Add destination"[^>]*disabled/);
    expect(withLegacy).toContain("Laptop");
    expect(withLegacy).toContain("1440×900");
  });

  it("uses one Primary term for the lead size and keeps technical roles out of the UI", () => {
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout,
      screen,
      specs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    const name = markup.match(/data-testid="store-target-name"[^>]*>(.*?)<\/span>/)?.[1];
    const roles = markup.match(/data-testid="store-target-roles"[^>]*>(.*?)<\/span><\/span>/)?.[1] ?? "";
    expect(name).toBe("1920×1080 · Landscape");
    expect(roles).toContain("Primary");
    expect(roles).not.toContain("lead");
    expect(roles).not.toContain("master");
    expect(roles).not.toContain("variant");
  });

  it("uses the whole card for accessible navigation without redundant indicators", () => {
    const variant = {
      ...screen,
      id: "web-desktop-1440",
      variantOf: screen.id,
      storeTargetId: "desktop-1440",
      artboard: { width: 1440, height: 900 },
    } as Screen;
    const mobile = {
      ...screen,
      id: "web-mobile",
      device: "mobile",
      artboard: { width: 390, height: 844 },
    } as Screen;
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout: { ...layout, screens: [screen, variant, mobile] },
      screen,
      specs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain('aria-label="Remove 1440×900 · Landscape output"');
    expect(markup).toContain('aria-label="Open 1440×900 · Landscape"');
    expect(markup).toMatch(/aria-label="Open [^"]+ output"/);
    expect(markup).toContain("absolute inset-0 rounded-lg");
    expect(markup).toContain('aria-current="true"');
    expect(markup).not.toContain("output-target-card");
    expect(markup).not.toContain("Current");
    expect(markup).not.toContain("lucide-check");
    expect(markup).not.toContain("lucide-arrow-right");
    expect(markup).toContain(editorUi.rowIconButtonDanger);
    expect(markup).not.toContain(">Remove<");
    expect(markup).not.toContain(">Open<");
  });

  it("allows removing either created family while keeping the last family protected", () => {
    const mobile = {
      ...screen,
      id: "web-mobile",
      device: "mobile",
      artboard: { width: 390, height: 844 },
    } as Screen;
    const withTwoFamilies = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout: { ...layout, screens: [screen, mobile] },
      screen,
      specs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));
    const withOneFamily = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout,
      screen,
      specs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(withTwoFamilies).toContain('aria-label="Remove Web · Desktop output"');
    expect(withTwoFamilies).toContain('aria-label="Remove Web · Mobile output"');
    expect(withOneFamily).not.toContain('aria-label="Remove Web · Desktop output"');
  });

  it("shows one canonical Android tablet family and hides the legacy family", () => {
    const androidPhone = {
      ...screen,
      id: "android-phone",
      platform: "android",
      device: "phone",
      artboard: { width: 1080, height: 1920 },
    } as Screen;
    const androidTablet = {
      ...androidPhone,
      id: "android-tablet",
      device: "tablet-7",
      artboard: { width: 1200, height: 1920 },
    } as Screen;
    const androidSpecs = {
      android: {
        phone: [{
          id: "phone-portrait",
          label: "Android phone portrait (lead)",
          width: 1080,
          height: 1920,
          orientation: "portrait",
        }],
        "tablet-7": [
          {
            id: "tablet-7-portrait",
            label: "7-inch Android tablet portrait (lead)",
            width: 1200,
            height: 1920,
            orientation: "portrait",
          },
          {
            id: "tablet-10-portrait",
            label: "10-inch Android tablet portrait",
            width: 1600,
            height: 2560,
            orientation: "portrait",
          },
        ],
        "tablet-10": [{
          id: "tablet-10-portrait",
          label: "10-inch Android tablet portrait (lead)",
          width: 1600,
          height: 2560,
          orientation: "portrait",
        }],
      },
    } as StoreSpecs;
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout: { ...layout, screens: [androidPhone, androidTablet] },
      screen: androidTablet,
      specs: androidSpecs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain("Tablet");
    expect(markup).toContain('aria-label="Add output size"');
    expect(markup).not.toContain("10-inch tablet (legacy)");
  });

  it("keeps an existing legacy Android tablet family visible and openable", () => {
    const androidPhone = {
      ...screen,
      id: "android-phone",
      platform: "android",
      device: "phone",
      artboard: { width: 1080, height: 1920 },
    } as Screen;
    const legacyTablet = {
      ...androidPhone,
      id: "android-tablet-10",
      device: "tablet-10",
      artboard: { width: 1600, height: 2560 },
    } as Screen;
    const androidSpecs = {
      android: {
        phone: [{
          id: "phone-portrait",
          label: "Android phone portrait (lead)",
          width: 1080,
          height: 1920,
          orientation: "portrait",
        }],
        "tablet-7": [{
          id: "tablet-7-portrait",
          label: "7-inch Android tablet portrait (lead)",
          width: 1200,
          height: 1920,
          orientation: "portrait",
        }],
        "tablet-10": [{
          id: "tablet-10-portrait",
          label: "10-inch Android tablet portrait (lead)",
          width: 1600,
          height: 2560,
          orientation: "portrait",
        }],
      },
    } as StoreSpecs;
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout: { ...layout, screens: [androidPhone, legacyTablet] },
      screen: androidPhone,
      specs: androidSpecs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain("10-inch tablet (legacy)");
    expect(markup).toContain(
      'aria-label="Open Google Play · 10-inch tablet (legacy) output"',
    );
  });

  it("keeps family size targets visible when a sibling master is selected", () => {
    const siblingMaster = {
      ...screen,
      id: "web-desktop-secondary",
      name: "Secondary",
    } as Screen;
    const firstRootVariant = {
      ...screen,
      id: "web-desktop-1440",
      variantOf: screen.id,
      storeTargetId: "desktop-1440",
      artboard: { width: 1440, height: 900 },
    } as Screen;
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout: { ...layout, screens: [screen, siblingMaster, firstRootVariant] },
      screen: siblingMaster,
      specs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain('aria-label="1440×900 · Landscape output target"');
    expect(markup).toContain('aria-label="Open 1440×900 · Landscape"');
    expect(markup).toContain('aria-label="Remove 1440×900 · Landscape output"');
  });

  it("does not leak a size target from another locale into the active family", () => {
    const frenchRoot = {
      ...screen,
      id: "web-desktop-fr",
      locale: "fr",
    } as Screen;
    const frenchVariant = {
      ...frenchRoot,
      id: "web-desktop-1440-fr",
      variantOf: frenchRoot.id,
      storeTargetId: "desktop-1440",
      artboard: { width: 1440, height: 900 },
    } as Screen;
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout: { ...layout, screens: [screen, frenchRoot, frenchVariant] },
      screen,
      specs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).not.toContain('aria-label="1440×900 · Landscape output target"');
  });

  it("explains and exposes the persisted screen-slot behavior without conflating layers", () => {
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout: {
        ...layout,
        screenSetPolicies: [{
          platform: "web",
          device: "desktop",
          locale: "en",
          mode: "synchronized",
        }],
      },
      screen,
      specs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain("Screen structure");
    expect(markup).toContain("Sync structure");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Content remains independent for every size.");
    expect(markup).toContain(editorUi.segmentedControl);
    expect(markup.indexOf("Screen structure")).toBeLessThan(
      markup.indexOf('aria-label="Screen structure behavior"'),
    );
  });

  it("lists promotion outputs alongside screenshot sizes without treating them as device families", () => {
    const androidScreen = {
      ...screen,
      id: "android-phone",
      platform: "android",
      device: "phone",
      artboard: { width: 1080, height: 1920 },
    } as Screen;
    const featureGraphic = {
      ...androidScreen,
      id: "android-phone-feature-graphic",
      variantOf: androidScreen.id,
      storeTargetId: "play-feature-graphic",
      artboard: { width: 1024, height: 500 },
    } as Screen;
    const androidSpecs = {
      android: {
        phone: [{
          id: "phone-portrait",
          label: "Android phone portrait (lead)",
          width: 1080,
          height: 1920,
          orientation: "portrait",
          kind: "device",
        }],
        "$outputs": [{
          id: "play-feature-graphic",
          label: "Google Play Feature Graphic",
          width: 1024,
          height: 500,
          orientation: "landscape",
          kind: "promotion",
          family: "phone",
        }],
      },
    } as StoreSpecs;
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout: { ...layout, screens: [androidScreen, featureGraphic] },
      screen: featureGraphic,
      specs: androidSpecs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain("Output sizes");
    expect(markup).not.toContain("Screenshot sizes");
    expect(markup).not.toContain("Promotional assets");
    expect(markup).toContain("Feature graphic");
    expect(markup).toContain("1024 × 500 px");
    expect(markup).not.toContain("Google Play Feature Graphic");
    expect(markup).not.toContain("$outputs");
    expect(markup).not.toContain("promotion output");
    expect(markup).not.toContain("lucide-check");
  });

  it("uses concise phone size names and keeps dimensions visible", () => {
    const androidScreen = {
      ...screen,
      id: "android-phone",
      platform: "android",
      device: "phone",
      artboard: { width: 1080, height: 1920 },
    } as Screen;
    const landscape = {
      ...androidScreen,
      id: "android-phone-landscape",
      variantOf: androidScreen.id,
      storeTargetId: "phone-landscape",
      artboard: { width: 1920, height: 1080 },
    } as Screen;
    const highResolution = {
      ...androidScreen,
      id: "android-phone-high-resolution",
      variantOf: androidScreen.id,
      storeTargetId: "phone-portrait-high-res",
      artboard: { width: 1440, height: 2560 },
    } as Screen;
    const androidSpecs = {
      android: {
        phone: [
          {
            id: "phone-portrait",
            label: "Android phone portrait (lead)",
            width: 1080,
            height: 1920,
            orientation: "portrait",
          },
          {
            id: "phone-landscape",
            label: "Android phone landscape",
            width: 1920,
            height: 1080,
            orientation: "landscape",
          },
          {
            id: "phone-portrait-high-res",
            label: "Android phone portrait high resolution",
            width: 1440,
            height: 2560,
            orientation: "portrait",
          },
        ],
      },
    } as StoreSpecs;
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout: { ...layout, screens: [androidScreen, landscape, highResolution] },
      screen: androidScreen,
      specs: androidSpecs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain("Google Play");
    expect(markup).toContain("Phone");
    expect(markup).toContain("Portrait");
    expect(markup).toContain("Landscape");
    expect(markup).toContain("Portrait · High-res");
    expect(markup).toContain("1080 × 1920 px");
    expect(markup).toContain("1920 × 1080 px");
    expect(markup).toContain("1440 × 2560 px");
    expect(markup).not.toContain("Android phone portrait high resolution");
  });

  it("preserves Apple product casing in family names", () => {
    const appleSpecs = {
      apple: {
        iphone: [{
          id: "6.9",
          label: '6.9" iPhone (lead)',
          width: 1320,
          height: 2868,
          orientation: "portrait",
        }],
        macos: [{
          id: "2880x1800",
          label: "Mac 2880×1800 (lead)",
          width: 2880,
          height: 1800,
          orientation: "landscape",
        }],
      },
    } as StoreSpecs;
    const iphone = {
      ...screen,
      id: "iphone",
      platform: "apple",
      device: "iphone",
      artboard: { width: 1320, height: 2868 },
    } as Screen;
    const mac = {
      ...screen,
      id: "mac",
      platform: "apple",
      device: "macos",
      artboard: { width: 2880, height: 1800 },
    } as Screen;
    const props = {
      specs: appleSpecs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    };

    const iphoneMarkup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      ...props,
      layout: { ...layout, screens: [iphone] },
      screen: iphone,
    }));
    const macMarkup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      ...props,
      layout: { ...layout, screens: [mac] },
      screen: mac,
    }));

    expect(iphoneMarkup).toContain("iPhone");
    expect(iphoneMarkup).not.toContain("IPhone");
    expect(macMarkup).toContain("macOS");
    expect(macMarkup).not.toContain("MacOS");
  });

  it("shows a standalone exact promotion target without inventing a primary device output", () => {
    const featureGraphic = {
      ...screen,
      id: "feature-graphic",
      platform: "android",
      device: "phone",
      storeTargetId: "play-feature-graphic",
      artboard: { width: 1024, height: 500 },
    } as Screen;
    const androidSpecs = {
      android: {
        phone: [{
          id: "phone-portrait",
          label: "Android phone portrait (lead)",
          width: 1080,
          height: 1920,
          orientation: "portrait",
          kind: "device",
        }],
        "$outputs": [{
          id: "play-feature-graphic",
          label: "Google Play Feature Graphic",
          width: 1024,
          height: 500,
          orientation: "landscape",
          kind: "promotion",
          family: "phone",
        }],
      },
    } as StoreSpecs;
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout: { ...layout, screens: [featureGraphic] },
      screen: featureGraphic,
      specs: androidSpecs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onRemoveOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain("Output sizes");
    expect(markup).not.toContain("Promotional assets");
    expect(markup).toContain("Feature graphic");
    expect(markup).not.toContain("This exact size has no primary output");
    expect(markup).not.toContain("Screen slots");
    expect(markup).not.toContain("Android phone portrait");
    expect(markup).not.toContain("Remove Feature graphic output");
  });
});
