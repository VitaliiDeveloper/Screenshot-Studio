// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import type { NodeConfig } from "@screenshot-studio/core/engine";
import { DEVICE_FRAME_PRESETS, type DeviceFrameElement } from "@screenshot-studio/core/model";
import { deviceFrameThumbnailNodeConfig } from "./DeviceFramePresetThumbnail.js";

vi.mock("react-konva", () => ({
  Layer: () => null,
  Stage: () => null,
}));
vi.mock("./EditorStage.js", () => ({ renderNodeConfigChild: () => null }));
vi.mock("@screenshot-studio/core/engine", () => ({
  elementToNodeConfig: vi.fn(),
}));

describe("DeviceFramePresetThumbnail", () => {
  it("requests the shared core elementToNodeConfig recipe for every catalog card", () => {
    const elementToNodeConfig = vi.fn<(element: DeviceFrameElement) => NodeConfig>(() => ({
      konva: "Rect" as const,
      config: { x: 0, y: 0, width: 1, height: 1 },
    }));

    for (const preset of DEVICE_FRAME_PRESETS) {
      deviceFrameThumbnailNodeConfig(preset, elementToNodeConfig);
    }

    expect(elementToNodeConfig).toHaveBeenCalledTimes(DEVICE_FRAME_PRESETS.length);
    expect(elementToNodeConfig.mock.calls.map(([element]) => element)).toEqual(
      DEVICE_FRAME_PRESETS.map((preset) => expect.objectContaining({
        type: "device-frame",
        deviceType: preset.id,
        assetUrl: undefined,
        fit: "cover",
      })),
    );
  });
});
