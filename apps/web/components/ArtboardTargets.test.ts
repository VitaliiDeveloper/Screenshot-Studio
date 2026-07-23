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
  it("names the section Output targets and keeps store-specific size terminology", () => {
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout,
      screen,
      specs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain("Output targets");
    expect(markup).toContain("Store listing sizes");
    expect(markup).not.toContain("Store outputs");
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
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(withoutLegacy).toMatch(/aria-label="Add output"[^>]*disabled/);
    expect(withLegacy).toContain("Web · Laptop");
    expect(withLegacy).toContain("Web laptop 1440×900");
  });

  it("keeps the lead marker out of the target name and orders it before master", () => {
    const markup = renderToStaticMarkup(React.createElement(ArtboardTargets, {
      layout,
      screen,
      specs,
      onOpen: vi.fn(),
      onCreateOutput: vi.fn(),
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    const name = markup.match(/data-testid="store-target-name"[^>]*>(.*?)<\/span>/)?.[1];
    const roles = markup.match(/data-testid="store-target-roles"[^>]*>(.*?)<\/span><\/span>/)?.[1] ?? "";
    expect(name).toBe("Web desktop 1920×1080");
    expect(roles.indexOf("lead")).toBeGreaterThanOrEqual(0);
    expect(roles.indexOf("lead")).toBeLessThan(roles.indexOf("master"));
  });

  it("uses accessible actions and lets selection styling replace redundant Current controls", () => {
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
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain('aria-label="Remove Web desktop 1440×900 variant"');
    expect(markup).toContain('aria-label="Open Web desktop 1440×900"');
    expect(markup).toMatch(/aria-label="Open [^"]+ output"/);
    expect(markup).toContain('aria-current="true"');
    expect(markup).not.toContain("Current");
    expect(markup).toContain(editorUi.rowIconButtonDanger);
    expect(markup).not.toContain(">Remove<");
    expect(markup).not.toContain(">Open<");
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
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain('aria-label="Web desktop 1440×900 store target"');
    expect(markup).toContain('aria-label="Open Web desktop 1440×900"');
    expect(markup).toContain('aria-label="Remove Web desktop 1440×900 variant"');
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
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).not.toContain('aria-label="Web desktop 1440×900 store target"');
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
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain("Screen slots");
    expect(markup).toContain("Keep 1:1");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Layer edits stay independent.");
    expect(markup).toContain(editorUi.segmentedControl);
    expect(markup.indexOf("Screen slots")).toBeLessThan(
      markup.indexOf('aria-label="Screen slot behavior"'),
    );
  });

  it("offers promotion outputs as targets without treating them as device families", () => {
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
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain("Google Play Feature Graphic");
    expect(markup).not.toContain("$outputs");
    expect(markup).not.toContain("promotion output");
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
      onCreate: vi.fn(),
      onRemove: vi.fn(),
      onScreenSetModeChange: vi.fn(),
    }));

    expect(markup).toContain("Google Play Feature Graphic");
    expect(markup).not.toContain("This exact size has no primary output");
    expect(markup).not.toContain("Screen slots");
    expect(markup).not.toContain("Android phone portrait");
    expect(markup).not.toContain("Remove Google Play Feature Graphic variant");
  });
});
