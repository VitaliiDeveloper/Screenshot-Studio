// SPDX-License-Identifier: Apache-2.0
import {
  DEVICE_FRAME_PRESETS,
  deviceFramePreset,
  type DeviceFrameId,
  type DeviceFrameRecommendation,
  type Screen,
} from "@screenshot-studio/core/model";

type DeviceFrameScreenContext = Pick<Screen, "platform" | "device" | "artboard">;

export interface DeviceFrameContext {
  readonly insertionPresetId: DeviceFrameId;
  readonly recommendedPresetId?: DeviceFrameId;
  readonly recommendation: DeviceFrameRecommendation;
  readonly unsuitablePresetIds: readonly DeviceFrameId[];
}

const decoratedWatchPresetIds = DEVICE_FRAME_PRESETS
  .filter((preset) => preset.group === "wearable" && preset.finish !== "frameless")
  .map(({ id }) => id);

/** Transient authoring guidance; no recommendation or suitability data is persisted. */
export function deviceFrameContextForScreen(
  screen?: DeviceFrameScreenContext | null,
): DeviceFrameContext {
  if (!screen) {
    return {
      insertionPresetId: "iphone",
      recommendedPresetId: "iphone",
      recommendation: "mobile",
      unsuitablePresetIds: [],
    };
  }

  const key = `${screen.platform}/${screen.device}`;
  if (key === "android/wear") {
    return {
      insertionPresetId: "frameless-watch",
      recommendedPresetId: undefined,
      recommendation: "wearable",
      unsuitablePresetIds: decoratedWatchPresetIds,
    };
  }

  const recommendation = (() => {
    switch (key) {
      case "apple/iphone":
      case "android/phone":
      case "web/mobile":
        return ["phone-modern-dark", "mobile"] as const;
      case "apple/ipad":
      case "android/tablet-7":
      case "android/tablet-10":
      case "web/tablet":
        return ["tablet-rounded-light", "tablet"] as const;
      case "web/desktop":
        return ["browser-dark", "web"] as const;
      case "apple/macos":
      case "android/chromebook":
      case "windows/desktop":
      case "web/laptop":
        return ["laptop-silver", "desktop"] as const;
      case "apple/tvos":
      case "android/tv":
      case "windows/xbox":
        return ["display-stand", "television"] as const;
      case "apple/watchos":
        return ["watch-square", "wearable"] as const;
      case "android/automotive":
        return ["automotive-display", "automotive"] as const;
      case "apple/visionos":
      case "android/xr":
      case "windows/holographic":
        return ["xr-viewport", "spatial"] as const;
      default:
        // The strict Screen schema currently makes this unreachable. Keep an active but future
        // family on the semantic catalog instead of silently falling back to the legacy preset.
        return ["phone-modern-dark", "mobile"] as const;
    }
  })();

  return {
    insertionPresetId: recommendation[0],
    recommendedPresetId: recommendation[0],
    recommendation: recommendation[1],
    unsuitablePresetIds: [],
  };
}

export function defaultDeviceFrameInputForScreen(
  screen?: DeviceFrameScreenContext | null,
): { deviceType: DeviceFrameId; width?: number; height?: number } {
  const context = deviceFrameContextForScreen(screen);
  if (context.insertionPresetId !== "frameless-watch") {
    return { deviceType: context.insertionPresetId };
  }
  const width = 300;
  const aspectRatio = deviceFramePreset(context.insertionPresetId).recipe.spec.aspectRatio;
  return {
    deviceType: context.insertionPresetId,
    width,
    height: width / aspectRatio,
  };
}
