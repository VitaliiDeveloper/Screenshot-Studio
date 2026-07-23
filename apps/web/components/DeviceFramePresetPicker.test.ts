// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEVICE_FRAME_PRESETS, type DeviceFrameId, type Screen } from "@screenshot-studio/core/model";
import {
  DeviceFramePresetCatalog,
  deviceFramePickerGroups,
  groupedVisibleDeviceFramePresets,
  nextDeviceFrameCardIndex,
} from "./DeviceFramePresetPicker.js";
import {
  defaultDeviceFrameInputForScreen,
  deviceFrameContextForScreen,
} from "@web/lib/editor-workspace";

Object.assign(globalThis, { React });
vi.mock("./DeviceFramePresetThumbnail.js", () => ({
  DeviceFramePresetThumbnail: () => React.createElement("span", { "aria-hidden": "true" }),
}));

const phoneScreen = {
  platform: "android",
  device: "phone",
  artboard: { width: 1080, height: 1920 },
} as Pick<Screen, "platform" | "device" | "artboard">;

function renderCatalog(
  query = "",
  selectedId: DeviceFrameId = "iphone",
  screen = phoneScreen,
): string {
  return renderToStaticMarkup(React.createElement(DeviceFramePresetCatalog, {
    query,
    selectedId,
    screen,
    onSelect: vi.fn(),
  }));
}

describe("DeviceFramePresetPicker catalog", () => {
  it("groups every legacy and semantic preset under human category names without visible raw IDs", () => {
    const markup = renderCatalog();

    expect(deviceFramePickerGroups.map(({ label }) => label)).toEqual([
      "Phone", "Tablet", "Browser", "Computer", "TV", "Watch", "Special", "Legacy",
    ]);
    for (const { label } of deviceFramePickerGroups) expect(markup).toContain(`>${label}<`);
    for (const preset of DEVICE_FRAME_PRESETS) {
      expect(markup).toContain(`>${preset.label}<`);
      if (preset.id !== preset.label) expect(markup).not.toContain(`>${preset.id}<`);
    }
    const legacyHeadingIndex = markup.indexOf(">Legacy<");
    expect(legacyHeadingIndex).toBeGreaterThan(0);
    for (const preset of DEVICE_FRAME_PRESETS) {
      const labelIndex = markup.indexOf(`>${preset.label}<`);
      expect(labelIndex > legacyHeadingIndex).toBe(preset.legacy);
    }
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Classic Phone");
  });

  it("searches human labels and tags, not internal preset IDs, and explains an empty result", () => {
    const tagMatch = renderCatalog("silver");
    expect(tagMatch).toContain("Laptop — Silver");
    expect(tagMatch).not.toContain("Modern Phone — Dark");

    const rawIdSearch = renderCatalog("phone-modern-dark");
    expect(rawIdSearch).toContain("No frames match");
    expect(rawIdSearch).not.toContain("Modern Phone — Dark");
  });

  it("derives brand-neutral recommendations and the Wear OS frameless submission warning", () => {
    expect(deviceFrameContextForScreen().recommendedPresetId).toBe("iphone");
    expect(deviceFrameContextForScreen(phoneScreen).recommendedPresetId).toBe("phone-modern-dark");
    expect(deviceFrameContextForScreen({
      platform: "web",
      device: "desktop",
      artboard: { width: 1920, height: 1080 },
    } as Pick<Screen, "platform" | "device" | "artboard">).recommendedPresetId).toBe("browser-dark");

    const wear = deviceFrameContextForScreen({
      platform: "android",
      device: "wear",
      artboard: { width: 384, height: 384 },
    } as Pick<Screen, "platform" | "device" | "artboard">);
    expect(wear.insertionPresetId).toBe("frameless-watch");
    expect(wear.recommendedPresetId).toBeUndefined();
    expect(wear.insertionAspectRatio).toBe(1);
    expect(wear.unsuitablePresetIds).toEqual(expect.arrayContaining([
      "watch", "watch-rounded", "watch-square",
    ]));
    expect(defaultDeviceFrameInputForScreen({
      platform: "android",
      device: "wear",
      artboard: { width: 384, height: 384 },
    } as Pick<Screen, "platform" | "device" | "artboard">)).toEqual({
      deviceType: "frameless-watch",
      width: 300,
      height: 300,
    });

    const markup = renderCatalog("watch", "watch", {
      platform: "android",
      device: "wear",
      artboard: { width: 384, height: 384 },
    } as Pick<Screen, "platform" | "device" | "artboard">);
    expect(markup).toContain("Not suitable for Google Play submission");
  });

  it("provides predictable roving keyboard navigation for every visible card", () => {
    expect(nextDeviceFrameCardIndex("ArrowRight", 0, 5)).toBe(1);
    expect(nextDeviceFrameCardIndex("ArrowLeft", 0, 5)).toBe(4);
    expect(nextDeviceFrameCardIndex("ArrowDown", 3, 5)).toBe(4);
    expect(nextDeviceFrameCardIndex("ArrowUp", 0, 5)).toBe(4);
    expect(nextDeviceFrameCardIndex("Home", 3, 5)).toBe(0);
    expect(nextDeviceFrameCardIndex("End", 1, 5)).toBe(4);
    expect(nextDeviceFrameCardIndex("Enter", 2, 5)).toBeNull();
  });

  it("moves to the adjacent rendered card in flattened group order", () => {
    const presets = groupedVisibleDeviceFramePresets("");
    const modernDarkIndex = presets.findIndex(({ id }) => id === "phone-modern-dark");
    const adjacentIndex = nextDeviceFrameCardIndex(
      "ArrowRight",
      modernDarkIndex,
      presets.length,
    );

    expect(adjacentIndex).not.toBeNull();
    expect(presets[adjacentIndex!]?.id).toBe("phone-modern-light");
  });
});
