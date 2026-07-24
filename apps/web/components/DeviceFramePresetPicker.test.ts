// SPDX-License-Identifier: Apache-2.0
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEVICE_FRAME_PRESETS, type DeviceFrameId, type Screen } from "@screenshot-studio/core/model";
import {
  DeviceFramePresetCatalog,
  deviceFramePickerGroups,
  groupedVisibleDeviceFramePresetOccurrences,
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

    expect(deviceFramePickerGroups).toEqual([
      {
        label: "Phone",
        presetIds: [
          "phone-modern-dark", "phone-modern-light", "phone-punch-hole-dark", "phone-outline",
          "frameless-phone",
        ],
      },
      {
        label: "Tablet",
        presetIds: ["tablet-rounded-dark", "tablet-rounded-light", "tablet-outline", "frameless-tablet"],
      },
      {
        label: "Browser",
        presetIds: ["browser-light", "browser-dark", "browser-minimal", "frameless-browser"],
      },
      {
        label: "Computer",
        presetIds: ["laptop-silver", "laptop-dark", "display-stand", "display-minimal"],
      },
      { label: "TV", presetIds: ["tv-flat", "display-minimal"] },
      { label: "Watch", presetIds: ["watch-rounded", "watch-square", "frameless-watch"] },
      { label: "Special", presetIds: ["foldable", "automotive-display", "xr-viewport"] },
      {
        label: "Legacy",
        presetIds: ["iphone", "android-phone", "tablet", "desktop", "laptop", "browser", "tv", "watch"],
      },
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

  it("makes every non-legacy core preset available with occurrence-safe duplicate keys", () => {
    const occurrences = groupedVisibleDeviceFramePresetOccurrences("");
    const semanticOccurrences = occurrences.filter(({ preset }) => !preset.legacy);
    const catalogPresetIds = DEVICE_FRAME_PRESETS.filter(({ legacy }) => !legacy).map(({ id }) => id);
    const pickerPresetIds = new Set(semanticOccurrences.map(({ preset }) => preset.id));

    expect([...pickerPresetIds]).toEqual(expect.arrayContaining(catalogPresetIds));
    expect(pickerPresetIds.size).toBe(catalogPresetIds.length);
    expect(semanticOccurrences).toHaveLength(catalogPresetIds.length + 1);
    expect(semanticOccurrences.map(({ groupLabel, preset }) => [groupLabel, preset.id])).toEqual(
      deviceFramePickerGroups.slice(0, -1).flatMap(({ label, presetIds }) =>
        presetIds.map((id) => [label, id])),
    );
    expect(occurrences.filter(({ preset }) => preset.legacy).map(({ preset }) => preset.id))
      .toEqual(["iphone", "android-phone", "tablet", "desktop", "laptop", "browser", "tv", "watch"]);
    expect(occurrences.filter(({ preset }) => preset.id === "display-minimal")
      .map(({ groupLabel }) => groupLabel)).toEqual(["Computer", "TV"]);
    expect(new Set(occurrences.map(({ occurrenceKey }) => occurrenceKey)).size)
      .toBe(occurrences.length);
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
    expect(wear.unsuitablePresetIds).toEqual(expect.arrayContaining([
      "watch", "watch-rounded", "watch-square",
    ]));
    expect(defaultDeviceFrameInputForScreen({
      platform: "android",
      device: "wear",
      artboard: { width: 384, height: 400 },
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
    const occurrences = groupedVisibleDeviceFramePresetOccurrences("");
    const modernDarkIndex = occurrences.findIndex(({ preset }) => preset.id === "phone-modern-dark");
    const adjacentIndex = nextDeviceFrameCardIndex(
      "ArrowRight",
      modernDarkIndex,
      occurrences.length,
    );

    expect(adjacentIndex).not.toBeNull();
    expect(occurrences[adjacentIndex!]?.preset.id).toBe("phone-modern-light");
  });

  it("navigates around both minimal-display occurrences independently", () => {
    const occurrences = groupedVisibleDeviceFramePresetOccurrences("");
    const computerDisplayIndex = occurrences.findIndex(({ groupLabel, preset }) =>
      groupLabel === "Computer" && preset.id === "display-minimal");
    const tvDisplayIndex = occurrences.findIndex(({ groupLabel, preset }) =>
      groupLabel === "TV" && preset.id === "display-minimal");

    expect(occurrences[nextDeviceFrameCardIndex(
      "ArrowRight", computerDisplayIndex, occurrences.length,
    )!]).toMatchObject({ groupLabel: "TV", preset: { id: "tv-flat" } });
    expect(occurrences[nextDeviceFrameCardIndex(
      "ArrowRight", tvDisplayIndex, occurrences.length,
    )!]).toMatchObject({ groupLabel: "Watch", preset: { id: "watch-rounded" } });
    expect(occurrences[computerDisplayIndex]!.occurrenceKey)
      .not.toBe(occurrences[tvDisplayIndex]!.occurrenceKey);
  });
});
